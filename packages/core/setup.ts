import fs from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execText, throwIfCancelled } from "./processes.ts";
import { findExecutable } from "./platform.ts";
import type { SnapshotEntry } from "./types.ts";

const maximum = 1024 * 1024;
const ignored = new Set([
  "node_modules",
  ".git",
  ".devteleport",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".next",
  ".yarn",
]);
const lockManagers: Record<string, string> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
};
const relevant = (file: string) => {
  const parts = file.split("/");
  return (
    !parts.slice(0, -1).some((p) => ignored.has(p) || p.startsWith(".")) &&
    (parts.at(-1) === "package.json" ||
      parts.at(-1)! in lockManagers ||
      [
        "pnpm-workspace.yaml",
        ".nvmrc",
        ".node-version",
        ".env.example",
        ".env.sample",
        ".env.template",
      ].includes(parts.at(-1)!))
  );
};
type Tool = { name: string; file: string | null; version: string | null };
export type DependencyPackage = {
  directory: string;
  name: string;
  framework: string;
  manager: string;
  requiredNode: string | null;
  requiredManager: string | null;
  nodeCompatible: boolean | null;
  dependencies: string[];
  installAt: string;
  command: string[];
  scripts: { name: string; command: string }[];
  environmentKeys: string[];
  blockers: string[];
  warnings: string[];
};
export type DependencyPlan = {
  id: string;
  packages: DependencyPackage[];
  tools: Tool[];
  inputs: { path: string; checksum: string; size: number }[];
  blockers: string[];
  warnings: string[];
};
const sha = (bytes: Buffer | string) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
const join = (dir: string, name: string) =>
  dir === "." ? name : dir + "/" + name;

// A conservative subset of Node engine ranges. Unknown syntax requires manual
// checking instead of treating an unverified version as compatible.
export function nodeSatisfies(version: string, range: string): boolean | null {
  const actual = version.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!actual) return null;
  const current = actual.slice(1).map(Number);
  const compare = (v: number[]) => {
    for (let i = 0; i < 3; i++)
      if (current[i] !== v[i]) return current[i] > v[i] ? 1 : -1;
    return 0;
  };
  const groups = range
    .trim()
    .split(/\s*\|\|\s*/)
    .map((group) => {
      if (["*", "x", ""].includes(group)) return true;
      const tokens = group.replace(/(>=|<=|>|<|\^|~|=)\s+/g, "$1").split(/\s+/);
      const values = tokens.map((token): boolean | null => {
        const m = token.match(
          /^(>=|<=|>|<|\^|~|=)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/,
        );
        if (!m) return null;
        const op = m[1] || "",
          parts = [m[2], m[3], m[4]],
          count = parts.findIndex(
            (p) => p === undefined || p === "x" || p === "*",
          ),
          precision = count === -1 ? 3 : count,
          lower = parts.map((p) => (/^\d+$/.test(p || "") ? Number(p) : 0)),
          n = compare(lower);
        if (op === ">=") return n >= 0;
        if (op === ">")
          return precision === 3
            ? n > 0
            : compare(
                precision === 1
                  ? [lower[0] + 1, 0, 0]
                  : [lower[0], lower[1] + 1, 0],
              ) >= 0;
        if (op === "<=")
          return precision === 3
            ? n <= 0
            : compare(
                precision === 1
                  ? [lower[0] + 1, 0, 0]
                  : [lower[0], lower[1] + 1, 0],
              ) < 0;
        if (op === "<") return n < 0;
        if (op === "^") {
          const upper =
            lower[0] > 0 || precision === 1
              ? [lower[0] + 1, 0, 0]
              : lower[1] > 0 || precision === 2
                ? [0, lower[1] + 1, 0]
                : [0, 0, lower[2] + 1];
          return n >= 0 && compare(upper) < 0;
        }
        if (op === "~")
          return (
            n >= 0 &&
            compare(
              precision === 1
                ? [lower[0] + 1, 0, 0]
                : [lower[0], lower[1] + 1, 0],
            ) < 0
          );
        return precision === 3
          ? n === 0
          : current.slice(0, precision).every((p, i) => p === lower[i]);
      });
      return values.includes(false)
        ? false
        : values.includes(null)
          ? null
          : true;
    });
  return groups.includes(true) ? true : groups.includes(null) ? null : false;
}

function toolEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COREPACK_ENABLE_NETWORK: "0",
    COREPACK_ENABLE_PROJECT_SPEC: "0",
    COREPACK_ENABLE_AUTO_PIN: "0",
  };
  delete env.DEVTELEPORT_PASSWORD;
  delete env.DEVTELEPORT_NEWER_PASSWORD;
  delete env.NODE_OPTIONS;
  return env;
}
async function toolsFor(names: string[]): Promise<Tool[]> {
  const dirs = (process.env.PATH || "")
    .split(path.delimiter)
    .filter(path.isAbsolute);
  return Promise.all(
    [...new Set(names)].map(async (name) => {
      const file = await findExecutable(name, dirs);
      let version: string | null = null;
      if (file)
        try {
          // Never probe package managers from inside an untrusted project.
          const out = await execText(file, ["--version"], {
            cwd: os.tmpdir(),
            env: toolEnvironment(),
            timeout: 5000,
            maxBuffer: 65536,
          });
          version = out.stdout.trim().split("\n")[0];
        } catch {}
      return { name, file, version };
    }),
  );
}

export async function planDependencies(
  entries: SnapshotEntry[],
  read: (entry: SnapshotEntry) => Promise<Buffer>,
): Promise<DependencyPlan> {
  const files = entries.filter((e) => e.type === "file" && relevant(e.path));
  const manifests = files.filter(
    (e) => path.posix.basename(e.path) === "package.json",
  );
  if (manifests.length > 100)
    throw new Error(
      "Dependency review supports at most 100 package manifests. Split this workspace before automatic installation.",
    );
  const byPath = new Map(files.map((e) => [e.path, e]));
  const readText = async (file: string) => {
    const e = byPath.get(file);
    if (!e) return null;
    if ((e.size ?? 0) > maximum)
      throw new Error("Setup metadata exceeds 1 MiB: " + file);
    const bytes = await read(e);
    if (bytes.length !== e.size || sha(bytes) !== e.checksum)
      throw new Error("Setup metadata checksum mismatch: " + file);
    return bytes.toString("utf8");
  };
  const parsed = new Map<string, Record<string, any>>();
  for (const file of manifests.sort((a, b) => a.path.localeCompare(b.path))) {
    const value = JSON.parse((await readText(file.path))!);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid package.json: " + file.path);
    parsed.set(path.posix.dirname(file.path), value);
  }
  const workspacePatterns = new Map<string, string[]>();
  for (const [dir, pkg] of parsed) {
    let patterns = pkg.workspaces?.packages ?? pkg.workspaces;
    const yaml = await readText(join(dir, "pnpm-workspace.yaml"));
    if (yaml) {
      // Only the literal package list is interpreted, never YAML tags/code.
      const section = yaml.match(/^packages:\s*\n((?:[ \t]+[^\n]*\n?)*)/m)?.[1];
      patterns = section
        ?.split("\n")
        .filter((line) => line.trim() && !line.trim().startsWith("#"))
        .map((line) =>
          line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/)?.[1]?.trim(),
        );
      if (
        !patterns?.length ||
        patterns.some((p: unknown) => typeof p !== "string")
      )
        throw new Error(
          "Review this pnpm workspace configuration manually before installing dependencies.",
        );
    }
    if (patterns !== undefined) {
      if (
        !Array.isArray(patterns) ||
        patterns.some(
          (p) =>
            typeof p !== "string" ||
            p.includes("..") ||
            p.startsWith("/") ||
            p.includes("\\"),
        )
      )
        throw new Error(
          "Unsupported workspace package patterns in " +
            join(dir, "package.json"),
        );
      workspacePatterns.set(dir, patterns);
    }
  }
  const managerFor = (dir: string) => {
    const declared = parsed.get(dir)?.packageManager;
    const locks = [
      ...new Set(
        Object.entries(lockManagers)
          .filter(([name]) => byPath.has(join(dir, name)))
          .map(([, manager]) => manager),
      ),
    ];
    const manager =
      typeof declared === "string"
        ? declared.split("@")[0]
        : locks.length === 1
          ? locks[0]
          : "npm";
    return {
      manager,
      conflict:
        locks.length > 1 || (locks.length === 1 && locks[0] !== manager),
    };
  };
  const packages: DependencyPackage[] = [];
  for (const [dir, pkg] of parsed) {
    const owners = [...workspacePatterns]
      .filter(([owner, patterns]) => {
        const relative = path.posix.relative(owner, dir);
        return (
          relative &&
          !relative.startsWith("../") &&
          patterns.some(
            (p) => !p.startsWith("!") && path.posix.matchesGlob(relative, p),
          ) &&
          !patterns.some(
            (p) =>
              p.startsWith("!") && path.posix.matchesGlob(relative, p.slice(1)),
          )
        );
      })
      .sort((a, b) => b[0].length - a[0].length);
    const installAt = owners[0]?.[0] ?? dir;
    const { manager, conflict } = managerFor(installAt);
    const deps = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
    }).sort();
    const frameworks: [string, string][] = [
      ["next", "Next.js"],
      ["@strapi/strapi", "Strapi"],
      ["vite", "Vite"],
      ["express", "Express"],
      ["@angular/core", "Angular"],
      ["nuxt", "Nuxt"],
      ["react", "React"],
      ["vue", "Vue"],
    ];
    const blockers: string[] = [],
      warnings: string[] = [];
    if (!["npm", "pnpm"].includes(manager))
      blockers.push(
        `Automatic ${manager} installation is not supported yet. Install this package manually.`,
      );
    if (conflict)
      blockers.push(
        "Conflicting package managers or lockfiles. Keep the intended manager and lockfile, then review again.",
      );
    let node = typeof pkg.engines?.node === "string" ? pkg.engines.node : null;
    const pin =
      (await readText(join(dir, ".nvmrc"))) ??
      (await readText(join(dir, ".node-version")));
    if (pin) warnings.push("Runtime version hint: " + pin.trim().slice(0, 100));
    if (!node && pin) node = pin.trim();
    const declaredManager = parsed.get(installAt)?.packageManager;
    const requiredManager =
      typeof declaredManager === "string" && /^[a-z]+@\d/.test(declaredManager)
        ? declaredManager.split("@")[1].split("+")[0]
        : null;
    if (
      installAt !== dir &&
      typeof pkg.packageManager === "string" &&
      pkg.packageManager.split("@")[0] !== manager
    )
      blockers.push(
        "This package declares a different manager from its workspace root. Review the workspace configuration before installing.",
      );
    const locked =
      manager === "npm"
        ? byPath.has(join(installAt, "package-lock.json")) ||
          byPath.has(join(installAt, "npm-shrinkwrap.json"))
        : byPath.has(join(installAt, "pnpm-lock.yaml"));
    if (!locked)
      warnings.push(
        "No lockfile: installation resolves dependency versions and creates a new lockfile.",
      );
    const environmentKeys = new Set<string>();
    for (const name of [".env.example", ".env.sample", ".env.template"]) {
      const text = await readText(join(dir, name));
      for (const m of text?.matchAll(
        /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm,
      ) ?? [])
        environmentKeys.add(m[1]);
    }
    const scripts = Object.entries(pkg.scripts || {})
      .filter(
        ([name, command]) =>
          /^(dev(?::[a-zA-Z0-9_-]+)?|develop|start)$/.test(name) &&
          typeof command === "string",
      )
      .map(([name, command]) => ({
        name,
        command: String(command).slice(0, 2000),
      }));
    packages.push({
      directory: dir,
      name: typeof pkg.name === "string" ? pkg.name.slice(0, 200) : dir,
      framework:
        frameworks.find(([key]) => deps.includes(key))?.[1] ?? "Node.js",
      manager,
      requiredNode: node,
      requiredManager,
      nodeCompatible: null,
      dependencies: deps,
      installAt,
      command:
        manager === "pnpm"
          ? [
              "pnpm",
              "install",
              locked ? "--frozen-lockfile" : "--no-frozen-lockfile",
            ]
          : [manager, locked ? "ci" : "install", "--no-audit", "--no-fund"],
      scripts,
      environmentKeys: [...environmentKeys].sort(),
      blockers,
      warnings,
    });
  }
  packages.sort(
    (a, b) =>
      (a.directory === "." ? 0 : a.directory.split("/").length) -
        (b.directory === "." ? 0 : b.directory.split("/").length) ||
      a.directory.localeCompare(b.directory),
  );
  const tools = packages.length
    ? await toolsFor([
        "node",
        ...packages
          .map((p) => p.manager)
          .filter((m) => ["npm", "pnpm"].includes(m)),
      ])
    : [];
  for (const pkg of packages) {
    for (const name of ["node", pkg.manager]) {
      const tool = tools.find((t) => t.name === name);
      if (["node", "npm", "pnpm"].includes(name) && !tool?.version)
        pkg.blockers.push(
          `Install a working native ${name} tool before automatic dependency installation.`,
        );
    }
    if (pkg.requiredManager) {
      const tool = tools.find((t) => t.name === pkg.manager);
      if (
        tool?.version &&
        nodeSatisfies(tool.version, pkg.requiredManager) !== true
      )
        pkg.blockers.push(
          `${pkg.manager} ${pkg.requiredManager} is declared by this project. Install that version explicitly, then review again.`,
        );
    }
    if (pkg.requiredNode && tools.find((t) => t.name === "node")?.version) {
      pkg.nodeCompatible = nodeSatisfies(
        tools.find((t) => t.name === "node")!.version!,
        pkg.requiredNode,
      );
      if (pkg.nodeCompatible !== true)
        pkg.blockers.push(
          pkg.nodeCompatible === false
            ? `Node ${pkg.requiredNode} is required; the installed Node version does not match.`
            : `Check Node engine range ${pkg.requiredNode} manually before installing.`,
        );
    }
  }
  const inputs = files
    .map((e) => ({ path: e.path, checksum: e.checksum!, size: e.size! }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const id = sha(JSON.stringify(inputs));
  return {
    id,
    inputs,
    packages,
    tools,
    blockers: packages.flatMap((p) =>
      p.blockers.map((b) => `${p.directory}: ${b}`),
    ),
    warnings: [
      "Installation uses the network and may execute project/dependency lifecycle scripts with your user permissions. It does not start your application.",
      "Credentials and system tools are configured separately. Environment hints show names only; they are not a complete credential check.",
    ],
  };
}

async function checkedPath(root: string, relative: string) {
  if (
    path.posix.isAbsolute(relative) ||
    relative.split("/").some((p) => p === "..") ||
    relative.includes("\\")
  )
    throw new Error("Unsafe setup path");
  let file = root;
  for (const part of relative.split("/").filter((p) => p !== ".")) {
    file = path.join(file, part);
    if ((await fs.lstat(file)).isSymbolicLink())
      throw new Error("Setup refuses symbolic-link package paths: " + relative);
  }
  return file;
}
export async function installDependencies(
  root: string,
  plan: DependencyPlan,
  approved: boolean,
  progress?: (phase: string) => void,
) {
  if (!approved)
    throw new Error(
      "Dependency installation requires explicit execution approval.",
    );
  if (plan.blockers.length)
    throw new Error(
      "Dependency preflight needs attention: " + plan.blockers.join(" "),
    );
  root = await fs.realpath(root);
  // Recheck every reviewed input before executing, including between packages:
  // a root lifecycle script must not silently change the CMS install plan.
  async function verifyInputs() {
    for (const input of plan.inputs) {
      const file = await checkedPath(root, input.path),
        hash = crypto.createHash("sha256");
      if ((await fs.lstat(file)).size !== input.size)
        throw new Error(
          "Dependency inputs changed; review again: " + input.path,
        );
      const handle = await fs.open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let bytes = 0;
      for await (const chunk of handle.createReadStream()) {
        bytes += chunk.length;
        if (bytes > input.size)
          throw new Error("Dependency input grew; review again: " + input.path);
        hash.update(chunk);
      }
      if (hash.digest("hex") !== input.checksum)
        throw new Error(
          "Dependency inputs changed; review again: " + input.path,
        );
    }
  }
  await verifyInputs();
  const completed: { directory: string; command: string; state: string }[] = [];
  for (const pkg of plan.packages.filter((p) => p.directory === p.installAt)) {
    throwIfCancelled();
    if (completed.length) await verifyInputs();
    const cwd = await checkedPath(root, pkg.directory),
      tool = plan.tools.find((t) => t.name === pkg.manager)!;
    progress?.(`Installing dependencies: ${pkg.directory} (${pkg.manager})`);
    try {
      await execText(tool.file!, pkg.command.slice(1), {
        cwd,
        env: toolEnvironment(),
        timeout: 3600000,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch {
      // Raw tool output can contain registry credentials, URLs or script output.
      throw new Error(
        `Dependency installation failed in ${pkg.directory}. Restored files and earlier successful installs remain. Review network access, package-manager script policy and the project's dependency requirements, then retry this package's displayed command in a trusted terminal. Tool output was withheld to protect credentials.`,
      );
    }
    completed.push({
      directory: pkg.directory,
      command: pkg.command.join(" "),
      state: "installed",
    });
  }
  return {
    state: "installed",
    completed,
    startup: plan.packages.map((p) => ({
      directory: p.directory,
      commands: p.scripts.map((s) => p.manager + " run " + s.name),
      environmentKeys: p.environmentKeys,
    })),
    note: "Dependency installation completed. Configure credentials/services and run the displayed startup commands. Application readiness has not been tested.",
  };
}

export async function reviewDependencies(
  entries: SnapshotEntry[],
  read: (entry: SnapshotEntry) => Promise<Buffer>,
): Promise<DependencyPlan> {
  try {
    return await planDependencies(entries, read);
  } catch {
    // Unsupported project metadata must not prevent an ordinary files-only
    // restore of an otherwise valid archive. It does prevent code execution.
    return {
      id: "",
      inputs: [],
      packages: [],
      tools: [],
      blockers: [
        "Dependency metadata could not be reviewed. Check package.json and workspace configuration manually, or restore with dependency installation off.",
      ],
      warnings: [],
    };
  }
}

export async function setupDirectory(
  directory: string,
  install = false,
  approved = false,
  progress?: (phase: string) => void,
) {
  const root = await fs.realpath(directory),
    entries: SnapshotEntry[] = [];
  let visited = 0;
  async function walk(dir: string) {
    for (const entry of await fs.readdir(path.join(root, dir), {
      withFileTypes: true,
    })) {
      if (++visited > 50000)
        throw new Error(
          "Setup scan exceeds 50,000 entries. Choose a smaller project.",
        );
      if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      const relative = dir ? dir + "/" + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) await walk(relative);
      } else if (entry.isFile() && relevant(relative)) {
        const file = path.join(root, relative),
          stat = await fs.stat(file),
          hash = crypto.createHash("sha256");
        if (stat.size > 32 * maximum)
          throw new Error("Setup input exceeds 32 MiB: " + relative);
        const handle = await fs.open(
          file,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        for await (const chunk of handle.createReadStream()) hash.update(chunk);
        entries.push({
          type: "file",
          path: relative,
          mode: stat.mode & 0o777,
          data: "",
          size: stat.size,
          checksum: hash.digest("hex"),
        });
      }
    }
  }
  await walk("");
  const plan = await planDependencies(entries, async (entry) => {
    const file = await checkedPath(root, entry.path),
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        total += chunk.length;
        if (total > maximum)
          throw new Error("Setup metadata grew beyond 1 MiB");
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } finally {
      await handle.close();
    }
  });
  return {
    root,
    ...plan,
    ...(install
      ? {
          installation: await installDependencies(
            root,
            plan,
            approved,
            progress,
          ),
        }
      : {}),
  };
}
