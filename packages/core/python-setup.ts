import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { SnapshotEntry } from "./types.ts";
import type { DependencyPackage } from "./setup.ts";

export const pythonMetadataNames = new Set([
  "pyproject.toml",
  "uv.lock",
  "uv.toml",
  "poetry.lock",
  "poetry.toml",
  "Pipfile",
  "Pipfile.lock",
  "setup.py",
  "setup.cfg",
  ".python-version",
  "requirements.txt",
  "requirements-dev.txt",
  "requirements.in",
]);
export function pythonMetadata(file: string) {
  const name = path.posix.basename(file);
  return (
    pythonMetadataNames.has(name) ||
    /^requirements(?:[-_.][A-Za-z0-9_.-]+)?\.(?:txt|in)$/.test(name) ||
    (file.split("/").slice(0, -1).includes("requirements") &&
      /\.(?:txt|in)$/.test(name))
  );
}
function requirementsOwner(file: string) {
  const parts = file.split("/");
  const directory = parts.slice(0, -1).indexOf("requirements");
  return directory >= 0 && /\.(?:txt|in)$/.test(parts.at(-1)!)
    ? parts.slice(0, directory).join("/") || "."
    : path.posix.dirname(file);
}
function isRequirementsFile(file: string) {
  return /\.(?:txt|in)$/.test(file) && pythonMetadata(file);
}
const at = (dir: string, file: string) =>
  dir === "." ? file : dir + "/" + file;
function safeRelative(from: string, value: string) {
  if (
    !value ||
    /["'`]/.test(value) ||
    value.includes("\\") ||
    /[\x00-\x1f]/.test(value) ||
    path.posix.isAbsolute(value) ||
    /^(?:[a-z][a-z0-9+.-]*:|~|\$)/i.test(value)
  )
    return null;
  const resolved = path.posix.normalize(path.posix.join(from, value));
  return resolved === ".." || resolved.startsWith("../") ? null : resolved;
}
function requirementName(line: string) {
  const wheel = path.posix
    .basename(line.split(/[;\s]/)[0])
    .match(/^([A-Za-z0-9_]+)-[^/]+\.whl$/)?.[1];
  if (wheel) return wheel.replace(/_/g, "-");
  const direct = line.match(
    /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[A-Za-z0-9_,.-]+\])?(?:\s*(?:[<>=!~;@]|$))/,
  )?.[1];
  if (direct) return direct;
  const egg = line.match(/[#&]egg=([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1];
  if (egg) return egg;
  return null;
}
function section(text: string, name: string) {
  const start = text.match(
    new RegExp(
      "^\\[" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\]\\s*(?:#.*)?$",
      "m",
    ),
  );
  if (!start || start.index === undefined) return "";
  return text.slice(start.index + start[0].length).split(/^\s*\[/m)[0];
}
function declaredPythonNames(text: string) {
  const names = new Set<string>();
  // Inventory only; the actual manager parses TOML and resolves versions.
  // Never return requirement values or source URLs, which may contain secrets.
  for (const match of text.matchAll(
    /["']([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[A-Za-z0-9_,.-]+\])?\s*(?:[<>=!~@][^"']*)?["']/g,
  )) {
    if (/[<>=!~@]/.test(match[0])) names.add(match[1]);
  }
  for (const [name, fields] of [
    ["project", ["dependencies"]],
    ["project.optional-dependencies", null],
    ["dependency-groups", null],
    ["build-system", ["requires"]],
  ] as const) {
    const body = section(text, name);
    for (const array of body.matchAll(
      /^\s*([A-Za-z0-9_-]+)\s*=\s*\[((?:[^\]"']|"[^"\r\n]*"|'[^'\r\n]*')*)\]/gm,
    )) {
      if (fields && !(fields as readonly string[]).includes(array[1])) continue;
      for (const value of array[2].matchAll(/["']([^"'\r\n]+)["']/g)) {
        const dependency = requirementName(value[1]);
        if (dependency) names.add(dependency);
      }
    }
  }
  for (const match of section(text, "tool.poetry.dependencies").matchAll(
    /^\s*["']?([A-Za-z0-9][A-Za-z0-9._-]*)["']?\s*=/gm,
  ))
    if (match[1] !== "python") names.add(match[1]);
  for (const heading of text.matchAll(
    /^\[tool\.poetry\.(?:group\.[A-Za-z0-9_-]+\.dependencies|dev-dependencies)\]\s*$/gm,
  )) {
    for (const match of section(text, heading[0].trim().slice(1, -1)).matchAll(
      /^\s*["']?([A-Za-z0-9][A-Za-z0-9._-]*)["']?\s*=/gm,
    ))
      if (match[1] !== "python") names.add(match[1]);
  }
  return [...names].sort();
}

export async function planPython(
  files: SnapshotEntry[],
  readText: (file: string) => Promise<string | null>,
): Promise<DependencyPackage[]> {
  const available = new Set(
    files.filter((entry) => entry.type === "file").map((entry) => entry.path),
  );
  const dirs = new Set(
    files
      .filter((entry) => entry.type === "file" && pythonMetadata(entry.path))
      .map((entry) =>
        isRequirementsFile(entry.path)
          ? requirementsOwner(entry.path)
          : path.posix.dirname(entry.path),
      ),
  );
  const packages: DependencyPackage[] = [];
  const sorted = [...dirs].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
  for (const dir of sorted) {
    const pyproject = await readText(at(dir, "pyproject.toml"));
    const canonical = ["requirements.txt", "requirements-dev.txt"].filter(
      (name) => available.has(at(dir, name)),
    );
    const profiles = [...available]
      .filter(
        (file) => isRequirementsFile(file) && requirementsOwner(file) === dir,
      )
      .map((file) => path.posix.relative(dir, file))
      .sort();
    const requirements = canonical.length
      ? canonical
      : profiles.length === 1
        ? profiles
        : [];
    const ambiguousProfiles = !canonical.length && profiles.length > 1;
    const hasPipfile =
      available.has(at(dir, "Pipfile")) ||
      available.has(at(dir, "Pipfile.lock"));
    const hasSetup =
      available.has(at(dir, "setup.py")) || available.has(at(dir, "setup.cfg"));
    const lockUv = available.has(at(dir, "uv.lock"));
    const lockPoetry = available.has(at(dir, "poetry.lock"));
    if (
      !pyproject &&
      !requirements.length &&
      !ambiguousProfiles &&
      !hasPipfile &&
      !hasSetup &&
      !lockUv &&
      !lockPoetry
    )
      continue;
    const blockers: string[] = [],
      warnings = [
        "Python packages are installed into DevTeleport's private project virtual environment, not the system Python. Package builds and manager plugins may execute project code.",
        "Private package feeds require separately configured credentials. Optional extras are installed only when selected by the project's default dependency configuration.",
        "After installation, activate this project's environment with: source .devteleport/python-env/bin/activate",
      ];
    let manager = "python3",
      command = [
        "python3",
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
      ];
    const names = new Set<string>();
    const installAt = dir;
    if (lockUv && lockPoetry)
      blockers.push(
        "Both uv.lock and poetry.lock are present. Keep the intended Python manager and review again.",
      );
    if (lockUv || /\[tool\.uv(?:\.|\])/.test(pyproject || "")) {
      manager = "uv";
      command = [
        "uv",
        "sync",
        ...(lockUv ? ["--locked"] : []),
        "--all-packages",
        "--all-groups",
        "--no-managed-python",
      ];
      if (!pyproject)
        blockers.push("uv setup requires a pyproject.toml in this folder.");
      if (/\[tool\.uv\.workspace\]/.test(pyproject || "")) {
        // All child Python manifests in a uv workspace are installed together;
        // complex membership cannot safely be inferred without uv itself.
        blockers.push(
          "uv workspace membership requires manual review; automatic setup currently supports standalone uv projects.",
        );
      }
      if (!lockUv)
        warnings.push(
          "No uv.lock: uv resolves dependency versions and creates a lockfile.",
        );
    } else if (lockPoetry || /\[tool\.poetry(?:\.|\])/.test(pyproject || "")) {
      manager = "poetry";
      command = ["poetry", "install", "--no-interaction"];
      if (!pyproject)
        blockers.push("Poetry setup requires a pyproject.toml in this folder.");
      if (!lockPoetry)
        warnings.push(
          "No poetry.lock: Poetry resolves dependency versions and creates a lockfile.",
        );
      if (/\[tool\.poetry\.requires-plugins\]/.test(pyproject || ""))
        blockers.push(
          "This Poetry project requires automatic plugin provisioning. Configure its plugins manually before automatic setup.",
        );
    } else if (requirements.length || ambiguousProfiles) {
      if (ambiguousProfiles)
        blockers.push(
          "Multiple Python requirements profiles need an explicit entrypoint (" +
            profiles.slice(0, 20).join(", ") +
            "). Add a requirements.txt with the intended local includes, then review again; profiles are not merged automatically.",
        );
      const visited = new Set<string>();
      async function reviewRequirements(file: string) {
        if (visited.has(file)) return;
        if (visited.size >= 100) {
          blockers.push(
            "Python requirements include more than 100 files; split or review them manually.",
          );
          return;
        }
        visited.add(file);
        const text = await readText(file);
        if (text === null) {
          blockers.push(
            "A Python requirements include is missing or unsupported: " + file,
          );
          return;
        }
        for (const raw of text.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
          const line = raw.trim();
          if (!line || line.startsWith("#")) continue;
          const include = line.match(
            /^(?:-r\s*|--requirement(?:\s+|=)|-c\s*|--constraint(?:\s+|=))(.+?)(?:\s+#.*)?$/,
          );
          if (include) {
            const included = safeRelative(
              path.posix.dirname(file),
              include[1].trim(),
            );
            if (
              !included ||
              !available.has(included) ||
              !pythonMetadata(included)
            )
              blockers.push(
                "Python requirements include must be a reviewed local metadata file inside the workspace: " +
                  file,
              );
            else await reviewRequirements(included);
            continue;
          }
          if (
            /^(?:--(?:target|prefix|root|user|python|config-settings|global-option|install-option|trusted-host|cert|client-cert)\b)/.test(
              line,
            )
          ) {
            blockers.push(
              "Python requirements contain destination or execution options that need manual review: " +
                file,
            );
            continue;
          }
          const editable = line.match(
            /^(?:-e\s*|--editable(?:\s+|=))(.+?)(?:\s+#.*)?$/,
          );
          const candidate = editable
            ? editable[1].trim()
            : line.split(/\s+--hash=/)[0];
          if (/\s+@\s+file:/i.test(candidate))
            blockers.push(
              "Python file-URL dependencies need manual path review: " + file,
            );
          const findLinks = line.match(
            /^(?:-f\s*|--find-links(?:\s+|=))(.+?)(?:\s+#.*)?$/,
          );
          if (
            findLinks &&
            !/^https?:\/\//i.test(findLinks[1]) &&
            !safeRelative(dir, findLinks[1].trim())
          )
            blockers.push(
              "Python package search paths must remain inside the workspace: " +
                file,
            );
          const namedLocal = candidate.match(
            /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,.-]+\])?\s+@\s+(.+)$/,
          )?.[1];
          if (
            namedLocal &&
            /^(?:\.{1,2}\/|\/|~|[A-Za-z]:[\\/])/.test(namedLocal) &&
            !safeRelative(dir, namedLocal)
          )
            blockers.push(
              "A named Python local dependency points outside the workspace: " +
                file,
            );
          if (
            /^(?:\.{1,2}\/|\/|~|file:|[A-Za-z]:[\\/])/.test(candidate) &&
            !safeRelative(dir, candidate)
          )
            blockers.push(
              "A Python local dependency points outside the workspace: " + file,
            );
          if (
            editable &&
            !/^(?:[a-z][a-z0-9+.-]*:)/i.test(candidate) &&
            !safeRelative(dir, candidate)
          )
            blockers.push(
              "A Python editable dependency points outside the workspace: " +
                file,
            );
          const name = requirementName(candidate);
          if (name) names.add(name);
        }
      }
      for (const name of ambiguousProfiles ? profiles : requirements) {
        command.push("-r", name);
        await reviewRequirements(at(dir, name));
      }
      warnings.push(
        "pip configuration files are disabled for this isolated installation. Supply private-feed access through trusted environment configuration or use a trusted terminal.",
      );
      if (pyproject)
        warnings.push(
          "requirements files take precedence over pip project installation. Follow the README if the project itself also needs an editable install.",
        );
    } else if (pyproject) {
      if (
        !/^\[project\]\s*(?:#.*)?$/m.test(pyproject) &&
        !/^\[build-system\]\s*(?:#.*)?$/m.test(pyproject)
      )
        blockers.push(
          "This pyproject.toml has no standard project/build metadata. Configure its Python installer manually.",
        );
      command.push(".");
      warnings.push(
        "pip installs the project's standard dependencies and build requirements. Optional extras and custom development groups require the project's documented setup command.",
      );
    } else {
      blockers.push(
        hasPipfile
          ? "Pipenv projects need manual setup; export reviewed requirements.txt or use Pipenv in a trusted terminal."
          : "Legacy setup.py/setup.cfg-only projects need manual review or a standard pyproject.toml/requirements.txt.",
      );
    }
    if (pyproject)
      for (const name of declaredPythonNames(pyproject)) names.add(name);
    const hint = pyproject?.match(
      /^\s*requires-python\s*=\s*["']([^"'\r\n]{1,100})["']/m,
    )?.[1];
    if (hint)
      warnings.push(
        "Python version requirement: " +
          hint +
          ". The package manager will enforce compatibility; DevTeleport does not download Python runtimes.",
      );
    if (!names.size)
      warnings.push(
        "Dependency names are resolved by the Python manager from the reviewed metadata; the preview is not a complete transitive dependency list.",
      );
    packages.push({
      directory: dir,
      installKey: manager + ":" + dir,
      installAt,
      ecosystem: "Python",
      runtimeTools: manager === "python3" ? ["python3"] : ["python3", manager],
      name:
        pyproject?.match(
          /^\s*name\s*=\s*["']([A-Za-z0-9][A-Za-z0-9._-]{0,199})["']/m,
        )?.[1] || (dir === "." ? "Python project" : path.posix.basename(dir)),
      framework: "Python",
      manager,
      requiredNode: null,
      requiredManager: null,
      nodeCompatible: null,
      dependencies: [...names].sort(),
      dependencyGroups: { declared: [...names].sort() },
      command,
      scripts: [],
      environmentKeys: [],
      blockers,
      warnings,
    });
  }
  return packages;
}

type Runner = (
  file: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => Promise<unknown>;
async function noLinkDirectory(file: string) {
  const stat = await fs.lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      "Python setup refuses symbolic-link or non-directory environment paths.",
    );
}
async function ownedEnvironment(cwd: string, pythonBase: string) {
  cwd = await fs.realpath(cwd);
  const metadata = path.join(cwd, ".devteleport");
  try {
    await fs.mkdir(metadata, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await noLinkDirectory(metadata);
  const environment = path.join(metadata, "python-env"),
    marker = path.join(metadata, "python-env-owner.json");
  let exists = false;
  try {
    await noLinkDirectory(environment);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (exists) {
    const handle = await fs.open(
      marker,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 4096)
        throw new Error("Invalid Python environment ownership record.");
      const owner = JSON.parse(await handle.readFile("utf8"));
      if (
        owner.formatVersion !== 1 ||
        owner.root !== cwd ||
        owner.pythonBase !== pythonBase
      )
        throw new Error(
          "Python setup refuses an environment that was not created for this project.",
        );
    } finally {
      await handle.close();
    }
  } else {
    // Claim a new directory exclusively. Never adopt a captured/user-created venv.
    await fs.mkdir(environment, { mode: 0o700 });
    try {
      await fs.writeFile(
        marker,
        JSON.stringify({ formatVersion: 1, root: cwd, pythonBase }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      await fs.rmdir(environment).catch(() => {});
      throw error;
    }
  }
  return environment;
}
export async function executePython(
  pkg: DependencyPackage,
  cwd: string,
  toolFile: string,
  run: Runner,
  sourceEnv: NodeJS.ProcessEnv,
  pythonFile?: string,
): Promise<boolean> {
  if (pkg.ecosystem !== "Python") return false;
  let base = pythonFile || (pkg.manager === "python3" ? toolFile : null);
  if (!base)
    throw new Error(
      "Review a working Python interpreter before installing Python packages.",
    );
  if (!path.isAbsolute(base)) {
    const candidates = (sourceEnv.PATH || "")
      .split(path.delimiter)
      .filter(path.isAbsolute)
      .map((dir) => path.join(dir, base!));
    base = null;
    for (const file of candidates) {
      try {
        await fs.access(file, constants.X_OK);
        base = file;
        break;
      } catch {}
    }
    if (!base)
      throw new Error("The reviewed Python interpreter is unavailable.");
  }
  const reviewedPython = await fs.realpath(base);
  const environment = await ownedEnvironment(cwd, reviewedPython);
  const bin = path.join(
    environment,
    process.platform === "win32" ? "Scripts" : "bin",
  );
  const python = path.join(
    bin,
    process.platform === "win32" ? "python.exe" : "python",
  );
  const env = {
    ...sourceEnv,
    VIRTUAL_ENV: environment,
    PATH: bin + path.delimiter + (sourceEnv.PATH || ""),
    PIP_REQUIRE_VIRTUALENV: "true",
    PIP_CONFIG_FILE: os.devNull,
    UV_PROJECT_ENVIRONMENT: environment,
    UV_PYTHON: python,
    UV_PYTHON_DOWNLOADS: "never",
    UV_NO_MANAGED_PYTHON: "1",
    POETRY_VIRTUALENVS_CREATE: "false",
    POETRY_VIRTUALENVS_IN_PROJECT: "false",
  };
  for (const key of [
    "PYTHONHOME",
    "PYTHONPATH",
    "PIP_TARGET",
    "PIP_PREFIX",
    "PIP_ROOT",
    "PIP_USER",
    "PIP_PYTHON",
    "PIP_NO_DEPS",
    "PIP_DRY_RUN",
    "UV_NO_SYNC",
    "UV_NO_INSTALL_PROJECT",
    "UV_NO_INSTALL_WORKSPACE",
    "UV_NO_INSTALL_PACKAGE",
    "UV_NO_DEFAULT_GROUPS",
    "UV_NO_DEV",
    "UV_PROJECT",
    "UV_PYTHON_PREFERENCE",
    "UV_MANAGED_PYTHON",
    "POETRY_ACTIVE",
  ])
    delete (env as NodeJS.ProcessEnv)[key];
  // macOS may expose an approved /usr/bin/python3 launcher whose actual Python
  // framework lives elsewhere. Ask only that approved interpreter, isolated
  // from project/user import paths, where its base executable resides.
  const probe = (await run(
    base,
    [
      "-I",
      "-S",
      "-c",
      "import os,sys;print(os.path.realpath(sys._base_executable))",
    ],
    env,
  )) as { stdout?: string } | undefined;
  const expected = probe?.stdout?.trim();
  if (!expected || !path.isAbsolute(expected) || /[\r\n\0]/.test(expected))
    throw new Error("Could not validate the reviewed Python base interpreter.");
  const expectedPython = await fs.realpath(expected);
  async function validateInterpreter() {
    const stat = await fs.lstat(python);
    if (stat.isSymbolicLink()) {
      if ((await fs.realpath(python)) !== expectedPython)
        throw new Error(
          "Python setup refuses a virtual-environment interpreter linked to another executable.",
        );
    } else if (stat.isFile()) {
      const original = await fs.stat(expectedPython);
      if (
        stat.size !== original.size ||
        stat.size > 64 * 1024 * 1024 ||
        crypto
          .createHash("sha256")
          .update(await fs.readFile(python))
          .digest("hex") !==
          crypto
            .createHash("sha256")
            .update(await fs.readFile(expectedPython))
            .digest("hex")
      )
        throw new Error(
          "Python setup refuses a modified virtual-environment interpreter.",
        );
    } else
      throw new Error(
        "Python setup refuses an unexpected virtual-environment interpreter.",
      );
  }
  let ready = false;
  try {
    await validateInterpreter();
    ready = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!ready)
    await run(
      pkg.manager === "python3" ? toolFile : "python3",
      [
        "-m",
        "venv",
        process.platform === "darwin" ? "--symlinks" : "--copies",
        environment,
      ],
      env,
    );
  await noLinkDirectory(environment);
  await noLinkDirectory(bin);
  await validateInterpreter();
  if (pkg.manager === "python3") await run(python, pkg.command.slice(1), env);
  else await run(toolFile, pkg.command.slice(1), env);
  return true;
}
