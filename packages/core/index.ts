import { verifyLfsCompleteness } from "./lfs.ts";
import { captureVolume, restoreVolume } from "./docker.ts";
import type {
  CaptureOptions,
  WorkspaceConfig,
  DatabaseConfig,
  SnapshotEntry,
  Manifest,
  RestoreOptions,
  PackageMetadata,
  ComposeService,
} from "./types.ts";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFile } from "node:child_process";
const exec = promisify(execFile);
const scrypt = (
  password: string,
  salt: Buffer,
  length: number,
  options: crypto.ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
export const LIMITS = {
  archive: 128 * 1024 * 1024,
  expanded: 256 * 1024 * 1024,
  file: 32 * 1024 * 1024,
  files: 50000,
};
const sha = (data: string | Uint8Array) =>
  crypto.createHash("sha256").update(data).digest("hex");
const excluded = new Set([
  "node_modules",
  ".devteleport",
  ".DS_Store",
  ".env",
  ".npmrc",
  ".netrc",
  ".pypirc",
  ".ssh",
  ".aws",
  ".gnupg",
  ".git-credentials",
  ".kube",
  ".docker",
  ".azure",
  ".envrc",
  ".yarnrc",
  ".yarnrc.yml",
]);
const sensitive = (p: string) =>
  /(^|\/)(\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|credentials(?:\.json)?|id_rsa|id_ed25519|\.npmrc|\.netrc|\.pypirc)$/i.test(
    p,
  );
export function safePath(p: string) {
  if (
    typeof p !== "string" ||
    !p ||
    p.includes("\\") ||
    p.includes("\0") ||
    p.includes(":") ||
    /[\x00-\x1f\x7f]/.test(p) ||
    p.split("/").some((x) => /[. ]$/.test(x)) ||
    p.startsWith("/") ||
    p.split("/").some((x) => !x || x === "." || x === "..") ||
    Buffer.byteLength(p) > 4096
  )
    throw new Error("Unsafe snapshot path");
  return p;
}
async function exists(p: string) {
  try {
    await fs.lstat(p);
    return true;
  } catch (caught) {
    const e = caught as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function run(
  tool: string,
  args: string[],
  cwd: string,
  extra: import("node:child_process").ExecFileOptionsWithStringEncoding = {},
) {
  try {
    if (tool === "git") {
      args = [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ];
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      );
      extra = {
        ...extra,
        env: {
          ...env,
          ...extra.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_NO_LAZY_FETCH: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
      };
    }
    return (
      await exec(tool, args, {
        cwd,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120000,
        ...extra,
      })
    ).stdout.trim();
  } catch (caught) {
    const e = caught as NodeJS.ErrnoException;
    throw new Error(
      `${tool} failed (${e.code ?? "unknown"}). Check tool availability, permissions and configuration.`,
    );
  }
}
async function optional(tool: string, args: string[], cwd: string) {
  try {
    return await run(tool, args, cwd);
  } catch {
    return null;
  }
}
async function config(root: string): Promise<WorkspaceConfig> {
  const p = path.join(root, "devteleport.json");
  if (!(await exists(p))) return {};
  const c = JSON.parse(await fs.readFile(p, "utf8"));
  if (
    c.exclude &&
    (!Array.isArray(c.exclude) ||
      c.exclude.some((x: unknown) => typeof x !== "string"))
  )
    throw new Error("exclude must be an array of relative path prefixes");
  for (const x of c.exclude ?? []) safePath(x);
  for (const key of Object.keys(c))
    if (!["exclude", "databases", "volumes"].includes(key))
      throw new Error("Unknown devteleport.json field: " + key);
  for (const group of ["databases", "volumes"]) {
    if (
      c[group] !== undefined &&
      (!Array.isArray(c[group]) || c[group].length > 50)
    )
      throw new Error("Invalid " + group + " configuration");
    const names = new Set();
    for (const item of c[group] ?? []) {
      if (
        !item ||
        typeof item.name !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(item.name) ||
        names.has(item.name)
      )
        throw new Error("Invalid or duplicate adapter name");
      names.add(item.name);
      const fields =
        group === "databases"
          ? ["name", "connectionEnv", "excludeSchemas", "excludeTables"]
          : ["name", "volume"];
      for (const key of Object.keys(item))
        if (!fields.includes(key))
          throw new Error("Unknown adapter field: " + key);
      if (group === "databases") {
        if (
          typeof item.connectionEnv !== "string" ||
          !/^[A-Z_][A-Z0-9_]*$/.test(item.connectionEnv)
        )
          throw new Error("Invalid connectionEnv");
        for (const field of ["excludeSchemas", "excludeTables"])
          if (
            item[field] !== undefined &&
            (!Array.isArray(item[field]) ||
              item[field].some(
                (x) =>
                  typeof x !== "string" ||
                  !x ||
                  x.length > 512 ||
                  x.includes("\0"),
              ))
          )
            throw new Error("Invalid database exclusions");
      } else if (
        typeof item.volume !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(item.volume)
      )
        throw new Error("Invalid volume name");
    }
  }

  return c;
}
async function gitIndexEntries(root: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return run(
    "git",
    [
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "ls-files",
      "--stage",
      "-z",
    ],
    root,
    {
      env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    },
  );
}
export async function inspect(directory = ".") {
  const requested = await fs.realpath(directory);
  const root =
    (await optional("git", ["rev-parse", "--show-toplevel"], requested)) ||
    requested;
  if (
    await optional(
      "git",
      ["config", "--local", "--get", "extensions.partialClone"],
      root,
    )
  )
    throw new Error(
      "Partial Git clones require conversion to a complete standalone repository before capture or inspection.",
    );
  const c = await config(root);
  let pkg: PackageMetadata = {};
  if (await exists(path.join(root, "package.json")))
    pkg = JSON.parse(
      await fs.readFile(path.join(root, "package.json"), "utf8"),
    );
  const lockfiles = [];
  for (const f of [
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ])
    if (await exists(path.join(root, f))) lockfiles.push(f);
  const compose = [];
  for (const f of [
    "compose.yaml",
    "compose.yml",
    "docker-compose.yaml",
    "docker-compose.yml",
  ])
    if (await exists(path.join(root, f))) compose.push(f);
  if (await exists(path.join(root, ".git")))
    await run("git", ["--version"], root);
  const git = (await exists(path.join(root, ".git")))
    ? {
        branch: await optional(
          "git",
          ["symbolic-ref", "--short", "HEAD"],
          root,
        ),
        commit: await optional("git", ["rev-parse", "--verify", "HEAD"], root),
        indexEntries: await gitIndexEntries(root),
        status: await optional(
          "git",
          ["status", "--porcelain=v1", "--untracked-files=all"],
          root,
        ),
      }
    : null;
  return {
    root,
    platform: { os: process.platform, architecture: process.arch },
    runtime: {
      node: process.versions.node,
      requiredNode: pkg.engines?.node ?? null,
      packageManager:
        pkg.packageManager ??
        (lockfiles[0]?.startsWith("pnpm")
          ? "pnpm"
          : lockfiles[0]?.startsWith("yarn")
            ? "yarn"
            : "npm"),
      lockfiles,
      scripts: pkg.scripts ?? {},
    },
    git,
    compose,
    volumes: (c.volumes ?? []).map((v) => ({
      name: v.name,
      volume: v.volume,
      status:
        "explicit opt-in local named-volume adapter; stop writers before capture",
    })),
    databases: (c.databases ?? []).map((d) => ({
      name: d.name,
      connectionEnv: d.connectionEnv,
      status: "explicit configuration; credentials read only at operation time",
    })),
    support: {
      files: "supported",
      git: "standalone repositories; linked worktrees, submodules and nested repositories rejected",
      database: "explicit local PostgreSQL; opt in",
      docker:
        "Compose analysis and approved startup; explicit plain local named-volume adapter",
      editor: "workspace files; saved tabs through extension",
      processes: "not supported",
    },
  };
}
async function enumerate(root: string, c: WorkspaceConfig) {
  const files: SnapshotEntry[] = [],
    omitted: string[] = [];
  let total = 0;
  async function walk(rel = "") {
    const entries = await fs.readdir(path.join(root, rel), {
      withFileTypes: true,
    });
    for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = rel ? `${rel}/${ent.name}` : ent.name;
      safePath(p);
      if (
        excluded.has(ent.name) ||
        ent.name.startsWith(".devteleport-") ||
        ent.name.includes(".dtp.partial-") ||
        sensitive(p) ||
        p.endsWith(".dtp") ||
        (c.exclude ?? []).some((x) => p === x || p.startsWith(x + "/"))
      ) {
        omitted.push(p);
        continue;
      }
      if (
        p === ".git/objects/info" ||
        p === ".git/worktrees" ||
        p === ".git/config" ||
        p === ".git/config.worktree" ||
        p === ".git/hooks" ||
        p === ".git/logs" ||
        p === ".git/COMMIT_EDITMSG" ||
        p === ".git/FETCH_HEAD"
      ) {
        omitted.push(p);
        continue;
      }
      if (ent.name === ".git" && (rel || !ent.isDirectory()))
        throw new Error(
          "Linked worktrees and nested Git repositories require separate captures.",
        );
      if (ent.name === ".gitmodules")
        throw new Error(
          "Submodules require separate captures; refusing an incomplete snapshot.",
        );
      const abs = path.join(root, p),
        st = await fs.lstat(abs);
      if (st.isDirectory()) {
        files.push({ path: p, type: "directory", mode: st.mode & 0o777 });
        await walk(p);
      } else if (st.isSymbolicLink()) {
        const target = await fs.readlink(abs);
        if (
          path.isAbsolute(target) ||
          target.includes("\\") ||
          target.includes("\0")
        )
          throw new Error(`Unsafe symlink: ${p}`);
        const resolved = path.resolve(path.dirname(abs), target);
        if (!resolved.startsWith(root + path.sep))
          throw new Error(`Symlink escapes workspace: ${p}`);
        files.push({ path: p, type: "symlink", target, mode: st.mode & 0o777 });
      } else if (st.isFile()) {
        if (st.size > LIMITS.file || (total += st.size) > LIMITS.archive)
          throw new Error("Capture exceeds size limits; configure exclusions.");
        const data = await fs.readFile(abs),
          after = await fs.stat(abs);
        if (
          st.size !== after.size ||
          st.mtimeMs !== after.mtimeMs ||
          st.ino !== after.ino
        )
          throw new Error(
            `File changed during capture: ${p}. Stop writers and retry.`,
          );
        if (
          !p.startsWith(".git/") &&
          /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}/.test(
            data.toString("utf8"),
          )
        ) {
          omitted.push(p + " (embedded credential detected)");
          continue;
        }
        files.push({
          path: p,
          type: "file",
          mode: st.mode & 0o777,
          size: data.length,
          checksum: sha(data),
          data: data.toString("base64"),
        });
      } else throw new Error(`Unsupported filesystem entry: ${p}`);
      if (files.length > LIMITS.files) throw new Error("Too many files");
    }
  }
  await walk();
  return { files, omitted };
}
function localConnection(c: WorkspaceConfig, d: DatabaseConfig | undefined) {
  if (
    !d ||
    typeof d.connectionEnv !== "string" ||
    !/^[A-Z_][A-Z0-9_]*$/.test(d.connectionEnv)
  )
    throw new Error(
      "Configure databases with name and connectionEnv in devteleport.json",
    );
  const value = process.env[d.connectionEnv];
  if (!value)
    throw new Error(
      `Set ${d.connectionEnv} to the local development database URL.`,
    );
  const u = new URL(value);
  if (!u.pathname || u.pathname === "/")
    throw new Error(
      "Specify an explicit development database name in the connection URL.",
    );
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
    /prod|production/i.test(decodeURIComponent(u.pathname))
  )
    throw new Error(
      "Only explicit localhost development databases are accepted.",
    );
  if ([...u.searchParams.keys()].some((k) => !["sslmode"].includes(k)))
    throw new Error(
      "Database URL supports sslmode only; host overrides are forbidden.",
    );
  return {
    PGHOST: u.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username) || os.userInfo().username,
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "10",
    PGSSLMODE: u.searchParams.get("sslmode") || "prefer",
  };
}
async function dbEnv(c: WorkspaceConfig, d: DatabaseConfig | undefined) {
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("PG")),
  );
  return { ...cleanEnv, ...localConnection(c, d) };
}
/** Adds Git-ignored paths to the configured exclusions, as capture does. */
async function withGitIgnored(root: string, c: WorkspaceConfig) {
  const ignored = await optional(
    "git",
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ],
    root,
  );
  if (ignored)
    c.exclude = [
      ...(c.exclude ?? []),
      ...ignored
        .split("\0")
        .filter(Boolean)
        .map((p) => p.replace(/\/$/, "")),
    ];
  return c;
}
/**
 * Lists the entries capture would include for a directory, without reading
 * Git integrity, databases or volumes. Used by diff to compare a live folder.
 */
export async function listWorkspace(directory = ".") {
  const root = await fs.realpath(directory);
  const c = await withGitIgnored(root, await config(root));
  return enumerate(root, c);
}
export async function capture(options: CaptureOptions = {}) {
  options.onProgress?.("Analyzing workspace");
  const report = await inspect(options.root ?? ".");
  const c = await withGitIgnored(report.root, await config(report.root));
  if (
    await exists(
      path.join(report.root, ".git", "objects", "info", "alternates"),
    )
  )
    throw new Error(
      "Git alternates depend on external objects; repack into an independent repository first.",
    );
  if (await exists(path.join(report.root, ".git", "shallow")))
    throw new Error(
      "Shallow repositories are not supported; unshallow before capture.",
    );
  options.onProgress?.("Enumerating and checking files");
  if (report.git) {
    try {
      await run("git", ["fsck", "--full", "--no-dangling"], report.root);
    } catch {
      throw new Error(
        "Git integrity check failed. Repair missing or corrupt Git objects before capture.",
      );
    }
  }
  const firstStatus = report.git?.status;
  const { files, omitted } = await enumerate(report.root, c);
  if (
    files.some(
      (file) =>
        file.path.startsWith(".git/objects/pack/") &&
        file.path.endsWith(".promisor"),
    )
  )
    throw new Error(
      "Promisor Git object packs require conversion to a complete standalone repository before capture.",
    );
  const lfs = report.git
    ? await verifyLfsCompleteness(report.root, files)
    : null;
  const name = options.name ?? path.basename(report.root);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(name))
    throw new Error(
      "Name must contain 1–100 letters, numbers, dots, underscores or hyphens.",
    );
  if (options.dryRun)
    return {
      report,
      lfs,
      name,
      fileCount: files.length,
      omitted,
      actions: [
        "Capture listed source and Git files",
        "Encrypt with AES-256-GCM",
      ],
      files: files.map(({ data, ...f }) => f),
    };
  if (typeof options.password !== "string" || options.password.length < 12)
    throw new Error("Use an encryption passphrase of at least 12 characters.");
  options.onProgress?.("Backing up selected databases and volumes");
  const databases = [];
  const volumes = [];
  if (options.includeVolumes) {
    if (!c.volumes?.length)
      throw new Error("No named volumes configured in devteleport.json");
    for (const v of c.volumes) {
      const data = await captureVolume(v.volume);
      if (data.length > LIMITS.file)
        throw new Error("Volume archive exceeds size limit");
      volumes.push({
        name: v.name,
        format: "docker-local-tar-gzip",
        checksum: sha(data),
        size: data.length,
        data: data.toString("base64"),
      });
    }
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "devteleport-db-"));
  await fs.chmod(temp, 0o700);
  try {
    if (options.includeDb) {
      if (!c.databases?.length)
        throw new Error("No databases configured in devteleport.json");
      for (const d of c.databases) {
        if (!/^[a-zA-Z0-9_-]+$/.test(d.name))
          throw new Error("Invalid database adapter name");
        const file = path.join(temp, d.name + ".dump");
        const env = await dbEnv(c, d);
        const serverVersion = Number(
          await run(
            "psql",
            [
              "-X",
              "-A",
              "-t",
              "-v",
              "ON_ERROR_STOP=1",
              "-c",
              "SHOW server_version_num",
            ],
            report.root,
            { env },
          ),
        );
        const toolVersion = await run("pg_dump", ["--version"], report.root);
        if (
          !Number.isInteger(serverVersion) ||
          serverVersion < 100000 ||
          Number(toolVersion.match(/(\d+)\./)?.[1]) <
            Math.floor(serverVersion / 10000)
        )
          throw new Error(
            "pg_dump must match or exceed the source PostgreSQL major version (10+ supported).",
          );
        await run(
          "pg_dump",
          [
            "--format=custom",
            "--no-owner",
            "--no-acl",
            "--file",
            file,
            ...(d.excludeSchemas ?? []).map((x) => "--exclude-schema=" + x),
            ...(d.excludeTables ?? []).map((x) => "--exclude-table=" + x),
          ],
          report.root,
          { env },
        );
        const data = await fs.readFile(file);
        if (data.length > LIMITS.file)
          throw new Error("Database dump exceeds size limit");
        await run("pg_restore", ["--list", file], report.root);
        databases.push({
          name: d.name,
          format: "postgres-custom",
          toolVersion,
          serverVersion,
          exclusions: {
            schemas: d.excludeSchemas ?? [],
            tables: d.excludeTables ?? [],
          },
          checksum: sha(data),
          size: data.length,
          data: data.toString("base64"),
        });
      }
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
  // Re-read every entry to detect a workspace changed while its archive was assembled.
  const second = await enumerate(report.root, c);
  if (
    sha(JSON.stringify(files)) !== sha(JSON.stringify(second.files)) ||
    firstStatus !== (await inspect(report.root)).git?.status
  )
    throw new Error(
      "Workspace changed during capture; stop writers and retry.",
    );
  const manifest = {
    formatVersion: 1,
    name,
    createdAt: new Date().toISOString(),
    platform: report.platform,
    runtime: report.runtime,
    git: report.git,
    services: report.compose.map((file) => ({
      file,
      status: options.includeVolumes
        ? "configuration and explicitly selected volume backups"
        : "configuration only; volumes excluded",
    })),
    databases,
    volumes,
    editor: { status: "saved workspace files only" },
    support: report.support,
    omitted,
    files,
  };
  validateManifest(manifest);
  options.onProgress?.("Validating and encrypting archive");
  const packed = gzipSync(Buffer.from(JSON.stringify(manifest)));
  if (packed.length > LIMITS.archive)
    throw new Error("Snapshot exceeds archive size limit");
  const salt = crypto.randomBytes(16),
    iv = crypto.randomBytes(12);
  const key = await scrypt(options.password, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("DTP1"));
  const encrypted = Buffer.concat([cipher.update(packed), cipher.final()]);
  key.fill(0);
  const output = path.resolve(options.output ?? ".", name + ".dtp");
  await fs.mkdir(path.dirname(output), { recursive: true });
  options.onProgress?.("Publishing encrypted snapshot");
  const partial = path.join(
    path.dirname(output),
    "." + name + ".dtp.partial-" + crypto.randomUUID(),
  );
  const handle = await fs.open(partial, "wx", 0o600);
  try {
    await handle.writeFile(
      Buffer.concat([
        Buffer.from("DTP1"),
        salt,
        iv,
        cipher.getAuthTag(),
        encrypted,
      ]),
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.link(partial, output);
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException;
    if (error.code === "EEXIST")
      throw new Error(
        `Snapshot already exists at ${output}. Choose another name or output directory.`,
      );
    throw error;
  } finally {
    await fs.rm(partial, { force: true });
  }
  return {
    output,
    fileCount: files.length,
    databases: databases.map((d) => d.name),
    volumes: volumes.map((v) => v.name),
    omitted,
  };
}
export function validateManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (!m || m.formatVersion !== 1)
    throw new Error(
      "Unsupported snapshot version; no automatic migrations are available.",
    );
  if (
    typeof m.name !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(m.name) ||
    !Array.isArray(m.files) ||
    m.files.length > LIMITS.files ||
    !m.platform ||
    typeof m.platform.os !== "string" ||
    typeof m.platform.architecture !== "string" ||
    !Array.isArray(m.databases)
  )
    throw new Error("Invalid manifest");
  const seen = new Map<string, SnapshotEntry>();
  let total = 0;
  for (const f of m.files) {
    safePath(f.path);
    const folded = f.path.normalize("NFC").toLowerCase();
    if (seen.has(folded))
      throw new Error("Duplicate or case-colliding snapshot paths");
    seen.set(folded, f);
    if (
      !Number.isInteger(f.mode) ||
      f.mode < 0 ||
      f.mode > 0o777 ||
      !["file", "directory", "symlink"].includes(f.type)
    )
      throw new Error("Invalid file metadata");
    if (f.path.split("/").some((x) => x.toLowerCase() === ".devteleport"))
      throw new Error("Reserved verification metadata path");
    if (
      f.path.split("/").some((x) => x.toLowerCase() === ".git" && x !== ".git")
    )
      throw new Error("Unsafe Git path alias");
    if (
      (f.path === ".git" && f.type !== "directory") ||
      f.path.startsWith(".devteleport/") ||
      f.path === ".devteleport"
    )
      throw new Error("Unsafe reserved snapshot path");
    if (
      f.path.startsWith(".git/") &&
      (f.path === ".git/config" ||
        f.path === ".git/config.worktree" ||
        f.path.startsWith(".git/hooks/") ||
        f.path.startsWith(".git/objects/info/") ||
        f.path.startsWith(".git/worktrees/") ||
        f.path === ".git/commondir" ||
        f.path === ".git/gitdir")
    )
      throw new Error("Unsafe Git configuration in snapshot");
    if (f.type === "file") {
      if (
        typeof f.data !== "string" ||
        f.data.length > Math.ceil(LIMITS.file / 3) * 4
      )
        throw new Error("Invalid file data");
      const data = Buffer.from(f.data, "base64");
      if (
        data.toString("base64") !== f.data ||
        data.length !== f.size ||
        sha(data) !== f.checksum ||
        data.length > LIMITS.file
      )
        throw new Error("File checksum or size mismatch");
      total += data.length;
    }
    if (f.type === "symlink") {
      if (
        typeof f.target !== "string" ||
        !f.target ||
        path.posix.isAbsolute(f.target) ||
        f.target.includes("\\") ||
        f.target.includes("\0")
      )
        throw new Error("Unsafe symlink");
      const dest = path.posix.normalize(
        path.posix.join(path.posix.dirname(f.path), f.target),
      );
      if (dest === ".." || dest.startsWith("../"))
        throw new Error("Symlink escapes workspace");
      if (f.path === ".git" || f.path.startsWith(".git/"))
        throw new Error("Git symlinks are unsupported");
    }
  }
  for (const f of m.files) {
    let parent = path.posix.dirname(f.path);
    while (parent !== ".") {
      if (seen.get(parent.normalize("NFC").toLowerCase())?.type !== "directory")
        throw new Error("Missing or unsafe parent directory");
      parent = path.posix.dirname(parent);
    }
  }
  for (const f of m.files.filter((f) => f.type === "symlink")) {
    const dest = path.posix.normalize(
      path.posix.join(path.posix.dirname(f.path), f.target),
    );
    const target = seen.get(dest.normalize("NFC").toLowerCase());
    if (!target || target.type === "symlink")
      throw new Error("Dangling and chained symlinks are unsupported");
    let parent = path.posix.dirname(dest);
    while (parent !== ".") {
      if (seen.get(parent.normalize("NFC").toLowerCase())?.type !== "directory")
        throw new Error("Unsafe symlink target");
      parent = path.posix.dirname(parent);
    }
  }
  if (m.volumes !== undefined && !Array.isArray(m.volumes))
    throw new Error("Invalid volumes manifest");
  for (const v of m.volumes ?? []) {
    if (
      typeof v.name !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(v.name) ||
      v.format !== "docker-local-tar-gzip" ||
      typeof v.data !== "string"
    )
      throw new Error("Invalid volume metadata");
    const b = Buffer.from(v.data, "base64");
    if (b.length !== v.size || b.length > LIMITS.file || sha(b) !== v.checksum)
      throw new Error("Volume checksum mismatch");
    total += b.length;
  }
  for (const d of m.databases) {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(d.name) ||
      d.format !== "postgres-custom" ||
      typeof d.data !== "string"
    )
      throw new Error("Invalid database metadata");
    const b = Buffer.from(d.data, "base64");
    if (b.length > LIMITS.file || b.length !== d.size || sha(b) !== d.checksum)
      throw new Error("Database checksum mismatch");
    total += b.length;
  }
  if (total > LIMITS.archive)
    throw new Error("Expanded content exceeds size limit");
  return m;
}
export async function readSnapshot(file: string, password: string | undefined) {
  const st = await fs.stat(file);
  if (st.size > LIMITS.archive + 48 || st.size < 48)
    throw new Error("Invalid snapshot size");
  const bytes = await fs.readFile(file);
  if (bytes.subarray(0, 4).toString() !== "DTP1")
    throw new Error("Unsupported snapshot format");
  if (typeof password !== "string")
    throw new Error("Encryption passphrase required");
  const key = await scrypt(password, bytes.subarray(4, 20), 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  let plain;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(20, 32),
    );
    decipher.setAAD(Buffer.from("DTP1"));
    decipher.setAuthTag(bytes.subarray(32, 48));
    plain = Buffer.concat([
      decipher.update(bytes.subarray(48)),
      decipher.final(),
    ]);
  } catch {
    throw new Error(
      "Cannot authenticate snapshot: incorrect passphrase or damaged archive.",
    );
  } finally {
    key.fill(0);
  }
  return validateManifest(
    JSON.parse(
      gunzipSync(plain, { maxOutputLength: LIMITS.expanded }).toString("utf8"),
    ),
  );
}
export async function restore(file: string, options: RestoreOptions = {}) {
  options.onProgress?.("Authenticating and validating snapshot");
  const m = await readSnapshot(file, options.password);
  const target = path.resolve(options.target ?? m.name);
  if (await exists(target))
    throw new Error(
      "Destination already exists. Choose a new empty destination path; existing paths are never overwritten.",
    );
  const warnings = [];
  if (
    m.platform.os !== process.platform ||
    m.platform.architecture !== process.arch
  )
    warnings.push(
      "OS or architecture differs. Reinstall native dependencies and review service compatibility.",
    );
  const requiredTools = [
    ...(m.git ? ["git"] : []),
    ...(options.install ? ["npm"] : []),
    ...(options.restoreDb ? ["pg_restore", "psql"] : []),
  ];
  const tools = await Promise.all(
    requiredTools.map(async (tool) => ({
      tool,
      available: (await optional(tool, ["--version"], process.cwd())) !== null,
    })),
  );
  if (tools.some((tool) => !tool.available))
    warnings.push(
      "Missing tools: " +
        tools
          .filter((tool) => !tool.available)
          .map((tool) => tool.tool)
          .join(", "),
    );
  const plan = {
    target,
    tools,
    fileCount: m.files.length,
    databases: m.databases.map((d) => d.name),
    volumes: (m.volumes ?? []).map((v) => v.name),
    warnings,
    actions: [
      "Restore verified files into a new directory",
      "Keep dependency installation and service startup disabled unless explicitly requested",
    ],
  };
  if (options.dryRun) return plan;
  if (options.restoreVolumes && !options.approveVolumes)
    throw new Error(
      "Volume restoration requires --approve-volumes and a trusted external destination mapping.",
    );
  if (options.install && !options.approveExecution)
    throw new Error(
      "Dependency scripts require --approve-execution after reviewing the snapshot.",
    );
  if (options.restoreDb && !options.approveDb)
    throw new Error(
      "Database restore requires --approve-db and an explicitly configured empty local destination.",
    );
  if (
    !options.dryRun &&
    tools.some((tool) => !tool.available && tool.tool !== "git")
  )
    throw new Error(
      "Install missing tools before requesting post-restore operations.",
    );
  await fs.mkdir(path.dirname(target), { recursive: true });
  options.onProgress?.("Restoring source and Git files");
  const stage = await fs.mkdtemp(
    path.join(path.dirname(target), ".devteleport-"),
  );
  await fs.chmod(stage, 0o700);
  let claimed = false;
  try {
    for (const f of m.files
      .filter((f) => f.type === "directory")
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length))
      await fs.mkdir(path.join(stage, f.path), { mode: 0o700 });
    for (const f of m.files.filter((f) => f.type === "file")) {
      await fs.writeFile(
        path.join(stage, f.path),
        Buffer.from(f.data, "base64"),
        { mode: 0o600, flag: "wx" },
      );
      await fs.chmod(path.join(stage, f.path), f.mode);
    }
    for (const f of m.files.filter((f) => f.type === "symlink"))
      await fs.symlink(f.target, path.join(stage, f.path));
    // Save a content inventory for independent verification. Never store payloads or secrets here.
    await fs.mkdir(path.join(stage, ".devteleport"), { mode: 0o700 });
    await fs.writeFile(
      path.join(stage, ".devteleport", "inventory.json"),
      JSON.stringify(
        {
          ...m,
          files: m.files.map(({ data, ...f }) => f),
          databases: m.databases.map(({ data, ...d }) => d),
          volumes: (m.volumes ?? []).map(({ data, ...v }) => v),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    for (const f of m.files
      .filter((f) => f.type === "directory")
      .sort((a, b) => b.path.length - a.path.length))
      await fs.chmod(path.join(stage, f.path), f.mode);
    await fs.writeFile(
      path.join(stage, ".devteleport", "journal.json"),
      JSON.stringify({
        status: "staged",
        snapshot: m.name,
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    // mkdir is the no-clobber claim: a concurrent creator cannot be overwritten by rename.
    await fs.mkdir(target, { mode: 0o700 });
    claimed = true;
    await fs.rename(
      path.join(stage, ".devteleport"),
      path.join(target, ".devteleport"),
    );
    await fs.writeFile(
      path.join(target, ".devteleport", "journal.json"),
      JSON.stringify({
        status: "restoring",
        snapshot: m.name,
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    for (const entry of await fs.readdir(stage))
      await fs.rename(path.join(stage, entry), path.join(target, entry));
    await fs.writeFile(
      path.join(target, ".devteleport", "journal.json"),
      JSON.stringify({
        status: "files-restored",
        snapshot: m.name,
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    await fs.rm(stage, { recursive: true, force: true });
  } catch (caught) {
    const e = caught as NodeJS.ErrnoException;
    if (claimed) await fs.rm(target, { recursive: true, force: true });
    throw e;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
  options.onProgress?.("Running explicitly approved post-restore actions");
  const postActions = [];
  if (options.restoreDb) {
    // Never trust database connection configuration from the snapshot.
    const c: WorkspaceConfig = JSON.parse(
      await fs.readFile(
        path.resolve(options.dbConfig ?? "devteleport-target.json"),
        "utf8",
      ),
    );
    for (const d of m.databases) {
      const destination = c.databases?.find((x) => x.name === d.name);
      const env = await dbEnv(c, destination);
      const serverVersion = Number(
        await run(
          "psql",
          [
            "-X",
            "-A",
            "-t",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "SHOW server_version_num",
          ],
          target,
          { env },
        ),
      );
      const restoreVersion = await run("pg_restore", ["--version"], target);
      if (
        (d.serverVersion &&
          Math.floor(serverVersion / 10000) <
            Math.floor(d.serverVersion / 10000)) ||
        Number(restoreVersion.match(/(\d+)\./)?.[1]) <
          Number(d.toolVersion?.match(/(\d+)\./)?.[1])
      )
        throw new Error(
          "Destination PostgreSQL and pg_restore must not be older than the captured server and dump utility.",
        );
      const count = await run(
        "psql",
        [
          "-X",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%';",
        ],
        target,
        { env },
      );
      if (count !== "0")
        throw new Error(
          "Target database is not empty; restore refused. Source files remain restored.",
        );
      const temp = await fs.mkdtemp(
        path.join(os.tmpdir(), "devteleport-restore-db-"),
      );
      await fs.chmod(temp, 0o700);
      try {
        const dump = path.join(temp, "database.dump");
        await fs.writeFile(dump, Buffer.from(d.data, "base64"), {
          mode: 0o600,
        });
        await run(
          "pg_restore",
          [
            "--no-owner",
            "--no-acl",
            "--exit-on-error",
            "--single-transaction",
            "--dbname",
            env.PGDATABASE,
            dump,
          ],
          target,
          { env },
        );
        postActions.push(`Database ${d.name} restored`);
      } finally {
        await fs.rm(temp, { recursive: true, force: true });
      }
    }
  }
  if (options.restoreVolumes) {
    const c: WorkspaceConfig = JSON.parse(
      await fs.readFile(
        path.resolve(options.dbConfig ?? "devteleport-target.json"),
        "utf8",
      ),
    );
    for (const v of m.volumes ?? []) {
      const dest = c.volumes?.find((x) => x.name === v.name);
      if (!dest) throw new Error("Missing trusted destination volume mapping");
      postActions.push(
        await restoreVolume(dest.volume, Buffer.from(v.data, "base64")),
      );
    }
  }
  if (options.install) {
    if (!(await exists(path.join(target, "package-lock.json"))))
      throw new Error(
        "Approved install supports npm ci with package-lock.json only. Files remain restored.",
      );
    await run("npm", ["ci"], target);
    postActions.push("npm ci completed");
  }
  await fs.writeFile(
    path.join(target, ".devteleport", "journal.json"),
    JSON.stringify({
      status: "complete",
      snapshot: m.name,
      completedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  options.onProgress?.("Verifying restored workspace");
  return { ...plan, verification: await verify(target), postActions };
}
export async function verify(
  directory: string,
  authoritativeManifest: Manifest | null = null,
) {
  const root = await fs.realpath(directory),
    m: Manifest =
      authoritativeManifest ??
      JSON.parse(
        await fs.readFile(
          path.join(root, ".devteleport", "inventory.json"),
          "utf8",
        ),
      );
  const problems = [];
  if (m.formatVersion !== 1 || !Array.isArray(m.files))
    throw new Error("Invalid verification inventory");
  for (const f of m.files) {
    safePath(f.path);
    const p = path.join(root, f.path);
    try {
      let parent = path.dirname(p);
      while (parent !== root) {
        if (!(await fs.lstat(parent)).isDirectory())
          throw new Error("Unsafe verification parent");
        parent = path.dirname(parent);
      }
      const st = await fs.lstat(p);
      if (f.type === "file") {
        let matches = st.isFile() && sha(await fs.readFile(p)) === f.checksum;
        // Git refreshes inode/timestamp caches after an independent restore.
        // Compare actual staged entries, never ignore staged content changes.
        if (
          !matches &&
          st.isFile() &&
          f.path === ".git/index" &&
          typeof m.git?.indexEntries === "string"
        ) {
          matches = (await gitIndexEntries(root)) === m.git.indexEntries;
        }
        if (!matches) problems.push(`${f.path}: content mismatch`);
      }
      if (f.type === "directory" && !st.isDirectory())
        problems.push(`${f.path}: type mismatch`);
      if (
        f.type === "symlink" &&
        (!st.isSymbolicLink() || (await fs.readlink(p)) !== f.target)
      )
        problems.push(`${f.path}: link mismatch`);
      if (f.type !== "symlink" && (st.mode & 0o777) !== f.mode)
        problems.push(`${f.path}: permissions differ`);
    } catch {
      problems.push(`${f.path}: missing or unreadable`);
    }
  }
  return { ok: problems.length === 0, checked: m.files.length, problems };
}
export async function history(directory = ".") {
  const output = [];
  for (const f of await fs.readdir(directory)) {
    if (f.endsWith(".dtp")) {
      const st = await fs.stat(path.join(directory, f));
      output.push({
        file: path.resolve(directory, f),
        bytes: st.size,
        modifiedAt: st.mtime.toISOString(),
        status: "encrypted; unlock to inspect",
      });
    }
  }
  return output;
}
export async function composePlan(root = ".") {
  const report = await inspect(root);
  if (!report.compose.length)
    throw new Error("No Docker Compose configuration found");
  const args = report.compose.flatMap((f) => ["-f", f]);
  // config may contain interpolated secrets: return a constrained projection only.
  const c = JSON.parse(
    await run(
      "docker",
      ["compose", ...args, "config", "--format", "json"],
      report.root,
    ),
  );
  const services: Record<string, ComposeService> = c.services ?? {};
  return {
    files: report.compose,
    services: Object.entries(services).map(([name, s]) => ({
      name,
      image: s.image ?? null,
      ports: s.ports ?? [],
      dependsOn: Object.keys(s.depends_on ?? {}),
      volumes: (s.volumes ?? []).map((v) => ({
        type: v.type,
        target: v.target,
      })),
    })),
    volumesCaptured: false,
    command: ["docker", "compose", ...args, "up", "-d"],
  };
}

export async function startServices(root: string, approved = false) {
  if (!approved)
    throw new Error(
      "Review the services plan, then pass --approve-execution to start containers.",
    );
  const plan = await composePlan(root);
  await run("docker", plan.command.slice(1), path.resolve(root));
  return { status: "started", plan };
}

export async function recover(directory: string) {
  const entries = [];
  for (const name of await fs.readdir(directory)) {
    if (name.includes(".dtp.partial-"))
      entries.push({
        path: path.resolve(directory, name),
        status: "interrupted capture; not an importable snapshot",
      });
    if (name.startsWith(".devteleport-"))
      entries.push({
        path: path.resolve(directory, name),
        status: "restore staging; inspect before manual removal",
      });
  }
  const journal = path.join(directory, ".devteleport", "journal.json");
  try {
    entries.push({
      path: journal,
      ...JSON.parse(await fs.readFile(journal, "utf8")),
    });
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") throw error;
  }
  return {
    entries,
    policy:
      "Read-only recovery inspection. Existing files are never deleted or merged automatically.",
  };
}
export async function verifyFromSnapshot(
  directory: string,
  snapshot: string,
  password: string,
) {
  const manifest = await readSnapshot(snapshot, password);
  return verify(directory, manifest);
}
