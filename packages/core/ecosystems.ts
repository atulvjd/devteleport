import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DependencyPackage } from "./setup.ts";
import type { SnapshotEntry } from "./types.ts";

/** Metadata only. These parsers never load a build file as executable code. */
export const ecosystemMetadataNames = new Set([
  "go.mod",
  "go.sum",
  "go.work",
  "go.work.sum",
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain",
  "rust-toolchain.toml",
  "Gemfile",
  "Gemfile.lock",
  ".ruby-version",
  ".ruby-gemset",
  "composer.json",
  "composer.lock",
  "auth.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
  "gradle.lockfile",
  "libs.versions.toml",
  "Directory.Build.props",
  "Directory.Build.targets",
  "Directory.Packages.props",
  "packages.lock.json",
  "packages.config",
  "nuget.config",
  "NuGet.Config",
  "global.json",
  "pubspec.yaml",
  "pubspec.lock",
  "pubspec_overrides.yaml",
  "Package.swift",
  "Package.resolved",
  "mix.exs",
  "mix.lock",
]);
export function isEcosystemMetadata(file: string) {
  return (
    ecosystemMetadataNames.has(path.posix.basename(file)) ||
    /\.(?:csproj|fsproj|vbproj|sln|slnx)$/.test(file) ||
    /(?:^|\/)\.mvn\/(?:maven\.config|jvm\.config|extensions\.xml)$/.test(
      file,
    ) ||
    /(?:^|\/)\.cargo\/config(?:\.toml)?$/.test(file) ||
    /(?:^|\/)\.bundle\/config$/.test(file) ||
    /(?:^|\/)gradle\/dependency-locks\/[^/]+\.lockfile$/.test(file)
  );
}
const join = (directory: string, name: string) =>
  directory === "." ? name : directory + "/" + name;
const parentOf = (parent: string, child: string) => {
  const relative = path.posix.relative(parent, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith("../") &&
    !path.posix.isAbsolute(relative)
  );
};
const safeNames = (names: string[]) =>
  [
    ...new Set(
      names.filter(
        (name) => name.length <= 240 && /^[A-Za-z0-9_@./:+-]+$/.test(name),
      ),
    ),
  ].sort();
const normalProjectPath = (directory: string, relative: string) => {
  if (
    !relative ||
    relative.includes("\\") ||
    relative.startsWith("/") ||
    relative.includes("\0")
  )
    return null;
  const resolved = path.posix.normalize(join(directory, relative));
  return resolved === ".." ||
    resolved.startsWith("../") ||
    path.posix.isAbsolute(resolved)
    ? null
    : resolved;
};
const warning =
  "The package manager downloads direct and transitive dependencies. Build files, plugins or install hooks may execute after approval. Required runtimes and private-feed credentials must already be configured; application readiness is not tested.";
function base(
  directory: string,
  ecosystem: string,
  manager: string,
  command: string[],
  dependencies: string[],
  locked = false,
): DependencyPackage {
  return {
    directory,
    ecosystem,
    name:
      directory === "."
        ? ecosystem + " project"
        : path.posix.basename(directory),
    framework: ecosystem,
    manager,
    requiredNode: null,
    requiredManager: null,
    nodeCompatible: null,
    dependencies: safeNames(dependencies),
    installAt: directory,
    installKey: manager + ":" + directory,
    command,
    scripts: [],
    environmentKeys: [],
    blockers: [],
    warnings: [
      warning,
      "The library list is a static preview of literal declarations, not an exhaustive resolved dependency graph. The package manager evaluates the complete project configuration after approval.",
      ...(locked
        ? []
        : [
            "No dependency lockfile was found for this installation. The package manager may resolve versions and create or update its dependency metadata.",
          ]),
    ],
  };
}
function objectNames(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}
function tomlNames(text: string, section: RegExp) {
  let active = false;
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const table = line.trim().match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
    if (table) {
      active = section.test(table[1]);
      continue;
    }
    if (active) {
      const key = line.match(
        /^\s*([A-Za-z0-9_-]+|"[A-Za-z0-9_-]+"|'[A-Za-z0-9_-]+')\s*=/,
      )?.[1];
      if (key) names.push(key.replace(/["']/g, ""));
    }
  }
  // TOML also permits [dependencies.some-crate] tables.
  for (const match of text.matchAll(
    /^\s*\[((?:[^\]\n]+\.)?(?:dev-|build-)?dependencies)\.([A-Za-z0-9_-]+)\]\s*$/gm,
  ))
    if (section.test(match[1])) names.push(match[2]);
  return safeNames(names);
}
function literalArray(text: string, field: string): string[] | null {
  const match = text.match(
    new RegExp("(?:^|\\n)\\s*" + field + "\\s*=\\s*\\[([\\s\\S]*?)\\]"),
  );
  if (!match) return null;
  const contents = match[1].replace(/#[^\n]*/g, "");
  const values = [...contents.matchAll(/["']([^"'\n]*)["']/g)].map((m) => m[1]);
  if (contents.replace(/["'][^"'\n]*["']/g, "").replace(/[\s,]/g, ""))
    return null;
  return values;
}
function xmlNames(text: string) {
  const names: string[] = [];
  for (const match of text.matchAll(
    /<(?:\w+:)?dependency\b[^>]*>([\s\S]*?)<\/(?:\w+:)?dependency>/g,
  )) {
    const group = match[1].match(
      /<(?:\w+:)?groupId>\s*([^<]+?)\s*<\/(?:\w+:)?groupId>/,
    )?.[1];
    const artifact = match[1].match(
      /<(?:\w+:)?artifactId>\s*([^<]+?)\s*<\/(?:\w+:)?artifactId>/,
    )?.[1];
    if (group && artifact) names.push(group + ":" + artifact);
  }
  return safeNames(names);
}

export async function planEcosystems(
  files: SnapshotEntry[],
  readText: (file: string) => Promise<string | null>,
): Promise<DependencyPackage[]> {
  const available = new Set(
    files.filter((file) => file.type === "file").map((file) => file.path),
  );
  const packages: DependencyPackage[] = [];
  const source = async (file: string) => (await readText(file)) || "";
  const matching = (name: string) =>
    [...available].filter((file) => path.posix.basename(file) === name).sort();
  const has = (directory: string, name: string) =>
    available.has(join(directory, name));

  for (const file of matching("go.mod")) {
    const directory = path.posix.dirname(file),
      text = await source(file),
      dependencies: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const required = line.match(
        /^\s*(?:require\s+)?([A-Za-z0-9][A-Za-z0-9._~/-]+)\s+v[0-9]/,
      )?.[1];
      if (required) dependencies.push(required);
    }
    const pkg = base(
      directory,
      "Go",
      "go",
      ["go", "mod", "download"],
      dependencies,
      has(directory, "go.sum"),
    );
    pkg.runtimeTools = ["go"];
    pkg.warnings.push(
      "Go's module cache is populated; this does not compile or start the project. Go toolchain auto-download is disabled.",
    );
    // A workspace can refer to directories outside the captured tree. Refuse
    // automatic setup until it is reviewed rather than silently ignoring it.
    if (
      [...available].some(
        (candidate) =>
          path.posix.basename(candidate) === "go.work" &&
          (path.posix.dirname(candidate) === directory ||
            parentOf(path.posix.dirname(candidate), directory)),
      )
    )
      pkg.blockers.push(
        "Go workspace configuration needs manual review before automatic installation. Review go.work and its module destinations, or set up this workspace manually.",
      );
    packages.push(pkg);
  }

  const cargo: {
    pkg: DependencyPackage;
    text: string;
    members: string[] | null;
    excludes: string[];
  }[] = [];
  for (const file of matching("Cargo.toml")) {
    const directory = path.posix.dirname(file),
      text = await source(file),
      locked = has(directory, "Cargo.lock");
    const dependencies = tomlNames(
      text,
      /(?:^|\.)(?:dev-|build-)?dependencies$/,
    );
    const pkg = base(
      directory,
      "Rust",
      "cargo",
      ["cargo", "fetch", ...(locked ? ["--locked"] : [])],
      dependencies,
      locked,
    );
    pkg.runtimeTools = ["cargo", "rustc"];
    const workspace = text.match(
      /^\s*\[workspace\]\s*(?:#.*)?$([\s\S]*?)(?=^\s*\[(?!\[)|$(?![\s\S]))/m,
    )?.[1];
    const members =
      workspace === undefined ? null : literalArray(workspace, "members");
    const excludes =
      workspace === undefined ? [] : literalArray(workspace, "exclude") || [];
    if (
      [...(members || []), ...excludes].some(
        (member) =>
          !normalProjectPath(directory, member) ||
          member.startsWith("/") ||
          member.includes("\\") ||
          member.split("/").includes("..") ||
          /^(?:[A-Za-z][A-Za-z0-9+.-]*:|~|\$)/.test(member) ||
          /[\x00-\x1f]/.test(member),
      )
    )
      pkg.blockers.push(
        "Rust workspace destinations must stay inside the captured workspace. Review Cargo.toml manually.",
      );
    if (workspace !== undefined && /\bmembers\s*=/.test(workspace) && !members)
      pkg.blockers.push(
        "Rust workspace members use unsupported metadata. Review the Cargo workspace before automatic installation.",
      );
    if (
      workspace !== undefined &&
      /\bexclude\s*=/.test(workspace) &&
      !literalArray(workspace, "exclude")
    )
      pkg.blockers.push(
        "Rust workspace exclusions use unsupported metadata. Review the Cargo workspace before automatic installation.",
      );
    cargo.push({ pkg, text, members, excludes });
  }
  for (const record of cargo) {
    const owner = cargo
      .filter(
        (candidate) =>
          candidate !== record &&
          candidate.members &&
          parentOf(candidate.pkg.directory, record.pkg.directory),
      )
      .sort((a, b) => b.pkg.directory.length - a.pkg.directory.length)
      .find((candidate) => {
        const relative = path.posix.relative(
          candidate.pkg.directory,
          record.pkg.directory,
        );
        return (
          candidate.members!.some(
            (pattern) =>
              !pattern.startsWith("/") &&
              !pattern.split("/").includes("..") &&
              path.posix.matchesGlob(relative, pattern),
          ) &&
          !candidate.excludes.some((pattern) =>
            path.posix.matchesGlob(relative, pattern),
          )
        );
      });
    if (owner) {
      record.pkg.installAt = owner.pkg.directory;
      record.pkg.installKey = owner.pkg.installKey;
      record.pkg.command = owner.pkg.command;
      record.pkg.warnings = [warning];
    }
    packages.push(record.pkg);
  }

  for (const file of matching("Gemfile")) {
    const directory = path.posix.dirname(file),
      text = await source(file);
    const names = [
      ...text.matchAll(/^\s*gem\s*(?:\(\s*)?["']([A-Za-z0-9_.-]+)["']/gm),
    ].map((match) => match[1]);
    const pkg = base(
      directory,
      "Ruby",
      "bundle",
      ["bundle", "install"],
      names,
      has(directory, "Gemfile.lock"),
    );
    pkg.runtimeTools = ["ruby", "bundle"];
    pkg.warnings.push(
      "Gemfile is executable Ruby. All groups are requested, subject to the project's supported platform and Bundler settings. Gems are installed into a project-local managed directory.",
    );
    packages.push(pkg);
  }

  for (const file of matching("composer.json")) {
    const directory = path.posix.dirname(file);
    let metadata;
    try {
      metadata = JSON.parse(await source(file));
    } catch {
      metadata = null;
    }
    const pkg = base(
      directory,
      "PHP",
      "composer",
      ["composer", "install", "--no-interaction", "--prefer-dist"],
      [
        ...objectNames(metadata?.require),
        ...objectNames(metadata?.["require-dev"]),
      ],
      has(directory, "composer.lock"),
    );
    pkg.runtimeTools = ["php", "composer"];
    pkg.dependencyGroups = {
      runtime: safeNames(objectNames(metadata?.require)),
      development: safeNames(objectNames(metadata?.["require-dev"])),
    };
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      pkg.blockers.push("Invalid composer.json: " + file);
    packages.push(pkg);
  }

  const maven: { pkg: DependencyPackage; modules: string[] }[] = [];
  for (const file of matching("pom.xml")) {
    const directory = path.posix.dirname(file),
      text = await source(file);
    const pkg = base(
      directory,
      "Java / Maven",
      "mvn",
      ["mvn", "--batch-mode", "--file", "./pom.xml", "dependency:go-offline"],
      xmlNames(text),
      true,
    );
    pkg.runtimeTools = ["java", "mvn"];
    if (/<!DOCTYPE|<!ENTITY/i.test(text) || !/<(?:\w+:)?project\b/.test(text))
      pkg.blockers.push(
        "Review the XML structure in " +
          file +
          " before automatic Maven setup.",
      );
    if (/<(?:\w+:)?profiles\b[\s\S]*<(?:\w+:)?modules\b/.test(text))
      pkg.blockers.push(
        "Profile-dependent Maven modules need manual review before automatic setup.",
      );
    const modules = [
      ...text.matchAll(/<(?:\w+:)?module>\s*([^<]+?)\s*<\/(?:\w+:)?module>/g),
    ].map((match) => normalProjectPath(directory, match[1]));
    if (
      modules.some(
        (module) => !module || !available.has(join(module, "pom.xml")),
      )
    )
      pkg.blockers.push(
        "A Maven module points outside the captured workspace or its pom.xml is missing. Review " +
          file +
          " manually.",
      );
    pkg.warnings.push(
      "Maven resolves project dependencies and plugins. Profiles and external repositories can change which artifacts are selected; no build/test lifecycle is requested.",
    );
    maven.push({
      pkg,
      modules: modules.filter((value): value is string => Boolean(value)),
    });
  }
  for (const record of maven) {
    const owner = maven
      .filter(
        (candidate) =>
          candidate !== record &&
          candidate.modules.includes(record.pkg.directory),
      )
      .sort((a, b) => a.pkg.directory.length - b.pkg.directory.length)[0];
    if (owner) {
      // Recursive module parent ownership is collapsed to the outer reactor.
      let top = owner;
      const seen = new Set([record]);
      while (!seen.has(top)) {
        seen.add(top);
        const next = maven.find(
          (candidate) =>
            candidate !== top && candidate.modules.includes(top.pkg.directory),
        );
        if (!next) break;
        top = next;
      }
      if (seen.has(top) && top === record)
        record.pkg.blockers.push(
          "Cyclic Maven module destinations require manual setup.",
        );
      else {
        record.pkg.installAt = top.pkg.directory;
        record.pkg.installKey = top.pkg.installKey;
        record.pkg.command = top.pkg.command;
      }
    }
    packages.push(record.pkg);
  }

  const gradleDirectories = [
    ...new Set(
      [...available]
        .filter((file) =>
          /(?:^|\/)(?:build|settings)\.gradle(?:\.kts)?$/.test(file),
        )
        .map((file) => path.posix.dirname(file)),
    ),
  ].sort();
  const gradle: { pkg: DependencyPackage; members: string[] }[] = [];
  for (const directory of gradleDirectories) {
    const buildFile = has(directory, "build.gradle.kts")
      ? "build.gradle.kts"
      : "build.gradle";
    const settingsFile = has(directory, "settings.gradle.kts")
      ? "settings.gradle.kts"
      : "settings.gradle";
    const build = has(directory, buildFile)
      ? await source(join(directory, buildFile))
      : "";
    const settings = has(directory, settingsFile)
      ? await source(join(directory, settingsFile))
      : "";
    const names = [
      ...build.matchAll(/["']([A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+):[^"'\n]+["']/g),
    ].map((match) => match[1]);
    const pkg = base(
      directory,
      "Java / Gradle",
      "gradle",
      [
        "gradle",
        "--no-daemon",
        "-Dorg.gradle.java.installations.auto-download=false",
        "--init-script",
        "<DevTeleport dependency resolver>",
        "devteleportResolveDependencies",
      ],
      names,
      has(directory, "gradle.lockfile"),
    );
    pkg.runtimeTools = ["java", "gradle"];
    pkg.warnings.push(
      "The installed Gradle is used; the captured gradlew wrapper is not executed. Project configuration and plugins run while resolving every resolvable configuration. No normal build/test tasks are requested.",
    );
    const members: string[] = [];
    for (const match of settings.matchAll(
      /^\s*include\s*(?:\(([^\n]*)\)|([^\n]+))\s*$/gm,
    )) {
      const literal = (match[1] || match[2]).replace(/\/\/.*$/, "");
      if (literal.replace(/["'][^"']*["']/g, "").replace(/[\s,]/g, "")) {
        pkg.blockers.push(
          "Dynamic Gradle include declarations require manual setup review.",
        );
        continue;
      }
      for (const part of literal.matchAll(/["']([^"']+)["']/g)) {
        const relative = part[1].replace(/^:/, "").replace(/:/g, "/");
        const member = normalProjectPath(directory, relative);
        if (!member)
          pkg.blockers.push(
            "A Gradle include points outside the captured workspace.",
          );
        else members.push(member);
      }
    }
    if (/\bprojectDir\s*=|\bincludeBuild\s*\(/.test(settings))
      pkg.warnings.push(
        "Custom Gradle project directories and composite builds are resolved by Gradle; separately discovered build roots remain separate installation actions.",
      );
    gradle.push({ pkg, members });
  }
  for (const record of gradle) {
    const owner = gradle
      .filter(
        (candidate) =>
          candidate !== record &&
          candidate.members.includes(record.pkg.directory),
      )
      .sort((a, b) => a.pkg.directory.length - b.pkg.directory.length)[0];
    if (owner) {
      record.pkg.installAt = owner.pkg.directory;
      record.pkg.installKey = owner.pkg.installKey;
      record.pkg.command = owner.pkg.command;
    }
    packages.push(record.pkg);
  }

  const projects = [...available]
    .filter((file) => /\.(?:csproj|fsproj|vbproj)$/.test(file))
    .sort();
  const solutions = [...available]
    .filter((file) => /\.(?:sln|slnx)$/.test(file))
    .sort();
  const dotnetOwners = new Map<string, string>();
  const dotnetPackages: DependencyPackage[] = [];
  for (const file of solutions) {
    const directory = path.posix.dirname(file),
      text = await source(file);
    const pkg = base(
      directory,
      ".NET",
      "dotnet",
      ["dotnet", "restore", "./" + path.posix.basename(file)],
      [],
      true,
    );
    pkg.runtimeTools = ["dotnet"];
    pkg.installKey = "dotnet:" + file;
    pkg.name = path.posix.basename(file);
    const references = file.endsWith(".slnx")
      ? [...text.matchAll(/<Project\b[^>]*\bPath=["']([^"']+)["']/g)].map(
          (m) => m[1],
        )
      : [
          ...text.matchAll(
            /^Project\([^\n]+?=\s*"[^"\n]*",\s*"([^"\n]+\.(?:csproj|fsproj|vbproj))"/gm,
          ),
        ].map((m) => m[1]);
    for (const reference of references) {
      const project = normalProjectPath(
        directory,
        reference.replace(/\\/g, "/"),
      );
      if (!project || !available.has(project))
        pkg.blockers.push(
          "A .NET solution project points outside the snapshot or is missing. Review " +
            file +
            ".",
        );
      else if (!dotnetOwners.has(project)) dotnetOwners.set(project, file);
    }
    if (
      references.length &&
      references.every((reference) => {
        const project = normalProjectPath(
          directory,
          reference.replace(/\\/g, "/"),
        );
        return (
          project && has(path.posix.dirname(project), "packages.lock.json")
        );
      })
    )
      pkg.command.push("--locked-mode");
    if (!references.length)
      pkg.warnings.push(
        "No literal project references were identified in this solution preview; dotnet evaluates the solution after approval.",
      );
    dotnetPackages.push(pkg);
  }
  for (const file of projects) {
    const directory = path.posix.dirname(file),
      text = await source(file);
    const names = [
      ...text.matchAll(
        /<PackageReference\b[^>]*\b(?:Include|Update)=["']([^"']+)["']/g,
      ),
    ].map((m) => m[1]);
    const owner = dotnetOwners.get(file);
    if (owner) {
      const parent = dotnetPackages.find(
        (pkg) => pkg.installKey === "dotnet:" + owner,
      )!;
      parent.dependencies = safeNames([...parent.dependencies, ...names]);
      continue;
    }
    const pkg = base(
      directory,
      ".NET",
      "dotnet",
      [
        "dotnet",
        "restore",
        "./" + path.posix.basename(file),
        ...(has(directory, "packages.lock.json") ? ["--locked-mode"] : []),
      ],
      names,
      has(directory, "packages.lock.json"),
    );
    pkg.runtimeTools = ["dotnet"];
    pkg.installKey = "dotnet:" + file;
    pkg.name = path.posix.basename(file);
    dotnetPackages.push(pkg);
  }
  packages.push(...dotnetPackages);

  for (const file of matching("pubspec.yaml")) {
    const directory = path.posix.dirname(file),
      text = await source(file),
      flutter = /^\s+sdk:\s*flutter\s*(?:#.*)?$/m.test(text);
    const groups: Record<string, string[]> = { runtime: [], development: [] };
    let active: string | null = null;
    for (const line of text.split(/\r?\n/)) {
      const section = line.match(/^([A-Za-z_]+):/);
      if (section)
        active =
          section[1] === "dependencies"
            ? "runtime"
            : section[1] === "dev_dependencies"
              ? "development"
              : null;
      if (active) {
        const name = line.match(/^  ([A-Za-z][A-Za-z0-9_]*):/)?.[1];
        if (name) groups[active].push(name);
      }
    }
    const manager = flutter ? "flutter" : "dart";
    const pkg = base(
      directory,
      flutter ? "Flutter" : "Dart",
      manager,
      [
        manager,
        "pub",
        "get",
        ...(has(directory, "pubspec.lock") ? ["--enforce-lockfile"] : []),
      ],
      [...groups.runtime, ...groups.development],
      has(directory, "pubspec.lock"),
    );
    pkg.runtimeTools = [manager];
    pkg.dependencyGroups = groups;
    if (/(?:^|[\s:[,{])[&*!][^\s'"#]/m.test(text.replace(/#[^\n]*/g, "")))
      pkg.blockers.push(
        "Pubspec YAML aliases or tags need manual dependency review before automatic setup.",
      );
    pkg.warnings.push(
      "Platform-specific mobile/desktop SDKs and native plugins may need additional manual setup. Pub get does not build the application.",
    );
    packages.push(pkg);
  }
  for (const [manifest, ecosystem, manager] of [
    ["Package.swift", "Swift", "swift"],
    ["mix.exs", "Elixir", "mix"],
  ]) {
    for (const file of matching(manifest)) {
      const directory = path.posix.dirname(file);
      const pkg = base(directory, ecosystem, manager, [], [], true);
      pkg.blockers.push(
        `${ecosystem} dependency metadata was detected in ${file}. Automatic ${ecosystem} setup is not supported by this release; follow the project's README in a trusted terminal.`,
      );
      packages.push(pkg);
    }
  }
  return packages;
}

async function checkedDirectory(directory: string) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      "Dependency installation refuses symbolic-link or non-directory destinations.",
    );
  return stat;
}
async function ensurePrivateDirectory(directory: string) {
  try {
    await fs.mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await checkedDirectory(directory);
}
async function managedBundlePath(cwd: string) {
  const root = await fs.realpath(cwd),
    rootStat = await checkedDirectory(root);
  const metadata = path.join(root, ".devteleport");
  await ensurePrivateDirectory(metadata);
  const directory = path.join(metadata, "bundle"),
    marker = path.join(metadata, "bundle-owner.json");
  const identity = {
    format: 1,
    root,
    device: rootStat.dev,
    inode: rootStat.ino,
  };
  let owned = false;
  try {
    const stat = await fs.lstat(marker);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
      throw new Error("Invalid managed Ruby dependency directory.");
    const owner = JSON.parse(await fs.readFile(marker, "utf8"));
    if (
      owner.format !== 1 ||
      owner.root !== root ||
      owner.device !== rootStat.dev ||
      owner.inode !== rootStat.ino
    )
      throw new Error(
        "The Ruby dependency directory belongs to another project. Choose manual setup.",
      );
    owned = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!owned) {
    // The exclusive mkdir refuses a captured or independently created path.
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(marker, JSON.stringify(identity), {
      mode: 0o600,
      flag: "wx",
    });
  }
  await checkedDirectory(directory);
  let entries = 0;
  async function validate(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (++entries > 100000)
        throw new Error(
          "Managed Ruby dependency directory is too large to validate automatically.",
        );
      if (entry.isSymbolicLink())
        throw new Error(
          "Managed Ruby dependency directory contains a symbolic link. Review it manually before retrying.",
        );
      if (entry.isDirectory()) await validate(path.join(dir, entry.name));
    }
  }
  await validate(directory);
  return directory;
}

/** Resolves Gradle artifacts through an app-authored init script after approval. */
export async function executeEcosystem(
  pkg: DependencyPackage,
  cwd: string,
  toolFile: string,
  run: (
    file: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
  ) => Promise<unknown>,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  if (pkg.manager === "bundle") {
    const bundle = await managedBundlePath(cwd);
    const locked = await fs.lstat(path.join(cwd, "Gemfile.lock")).then(
      (stat) => {
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error("Ruby setup refuses a non-regular Gemfile.lock.");
        return true;
      },
      (error) => {
        if (error.code !== "ENOENT") throw error;
        return false;
      },
    );
    await run(toolFile, pkg.command.slice(1), {
      ...env,
      BUNDLE_GEMFILE: path.join(cwd, "Gemfile"),
      BUNDLE_PATH: bundle,
      BUNDLE_BIN: path.join(bundle, "bin"),
      BUNDLE_USER_HOME: path.join(bundle, "user"),
      BUNDLE_DISABLE_SHARED_GEMS: "true",
      BUNDLE_WITHOUT: "",
      BUNDLE_WITH: "",
      BUNDLE_DEPLOYMENT: "false",
      BUNDLE_FROZEN: String(locked),
    });
    return true;
  }
  if (pkg.manager === "composer") {
    const metadata = JSON.parse(
      await fs.readFile(path.join(cwd, "composer.json"), "utf8"),
    );
    const configured = metadata.config?.["vendor-dir"] ?? "vendor";
    if (typeof configured !== "string" || !normalProjectPath(".", configured))
      throw new Error(
        "Composer vendor directory must stay inside the restored package.",
      );
    const vendor = path.resolve(cwd, configured);
    if (vendor === cwd || !vendor.startsWith(cwd + path.sep))
      throw new Error(
        "Composer vendor directory must stay inside the restored package.",
      );
    let current = cwd;
    for (const part of path.relative(cwd, vendor).split(path.sep)) {
      current = path.join(current, part);
      try {
        await checkedDirectory(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
    }
    await run(toolFile, pkg.command.slice(1), {
      ...env,
      COMPOSER: path.join(cwd, "composer.json"),
      COMPOSER_VENDOR_DIR: vendor,
      COMPOSER_NO_DEV: "0",
    });
    return true;
  }
  if (pkg.manager !== "gradle") return false;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "devteleport-gradle-"));
  try {
    const init = path.join(temp, "resolve.gradle");
    await fs.writeFile(
      init,
      `gradle.projectsEvaluated {
  def root = gradle.rootProject
  if (root.tasks.findByName('devteleportResolveDependencies') != null) {
    throw new GradleException('DevTeleport dependency task name already exists; use manual setup.')
  }
  root.tasks.register('devteleportResolveDependencies') {
    doLast {
      root.allprojects.each { project ->
        project.buildscript.configurations.findAll { it.canBeResolved }.each { it.resolve() }
        project.configurations.findAll { it.canBeResolved }.each { it.resolve() }
      }
    }
  }
}
`,
      { mode: 0o600, flag: "wx" },
    );
    await run(
      toolFile,
      pkg.command
        .slice(1)
        .map((arg) =>
          arg === "<DevTeleport dependency resolver>" ? init : arg,
        ),
      env,
    );
    return true;
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
