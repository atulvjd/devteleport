import { execText, trackChild, registerCleanup } from "./processes.ts";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
async function executable(file: string) {
  try {
    await fs.access(file, 1);
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}
export async function searchDirectories(configured: string[] = []) {
  const directories = [
    ...configured,
    path.dirname(process.execPath),
    ...(process.env.PATH ?? "").split(path.delimiter),
    ...(process.env.HOMEBREW_PREFIX
      ? [path.join(process.env.HOMEBREW_PREFIX, "bin")]
      : []),
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
    path.join(os.homedir(), ".docker", "bin"),
    "/Applications/Docker.app/Contents/Resources/bin",
    path.join(os.homedir(), ".volta", "bin"),
    path.join(os.homedir(), ".asdf", "shims"),
    path.join(os.homedir(), ".local", "share", "mise", "shims"),
  ];
  try {
    const base = path.join(
      process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm"),
      "versions",
      "node",
    );
    for (const name of (await fs.readdir(base)).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    ))
      directories.push(path.join(base, name, "bin"));
  } catch {}
  const brew = await findExecutable("brew", directories);
  if (brew) {
    try {
      const prefix = (
        await exec(brew, ["--prefix"], { timeout: 5000, maxBuffer: 65536 })
      ).stdout.trim();
      if (path.isAbsolute(prefix)) {
        directories.push(path.join(prefix, "bin"));
        const opt = path.join(prefix, "opt");
        for (const name of (await fs.readdir(opt))
          .filter((x) => /^postgresql(?:@\d+)?$|^libpq(?:@\d+)?$/.test(x))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })))
          directories.push(path.join(opt, name, "bin"));
      }
    } catch {}
  }
  return [...new Set(directories.filter((p) => p && path.isAbsolute(p)))];
}
export async function findExecutable(name: string, directories: string[]) {
  for (const directory of directories) {
    const file = path.join(directory, name);
    if (await executable(file)) return fs.realpath(file);
  }
  return null;
}
export async function diagnostics(configured: string[] = []) {
  const directories = await searchDirectories(configured),
    tools = [];
  for (const name of [
    "node",
    "npm",
    "pnpm",
    "yarn",
    "git",
    "docker",
    "pg_dump",
    "pg_restore",
    "psql",
    "openssl",
  ]) {
    const file = await findExecutable(name, directories);
    if (!file) {
      tools.push({
        name,
        status: "missing",
        path: null,
        recommendation:
          "Install explicitly or configure a trusted tool directory. No software was installed.",
      });
      continue;
    }
    let version: string | null = null,
      architecture = "unknown";
    try {
      version = (
        await exec(file, ["--version"], {
          timeout: 5000,
          maxBuffer: 65536,
          env: { ...process.env, PATH: directories.join(path.delimiter) },
        })
      ).stdout
        .trim()
        .split("\n")[0];
    } catch {}
    try {
      const kind = (
        await exec("/usr/bin/file", ["-b", "-L", file], {
          timeout: 5000,
          maxBuffer: 65536,
        })
      ).stdout;
      architecture = kind.includes("arm64")
        ? kind.includes("x86_64")
          ? "universal"
          : "arm64"
        : kind.includes("x86_64")
          ? "x64"
          : /script|text/i.test(kind)
            ? "script"
            : "unknown";
    } catch {}
    tools.push({
      name,
      path: file,
      version,
      architecture,
      status:
        process.platform === "darwin" &&
        process.arch === "arm64" &&
        architecture === "x64"
          ? "incompatible"
          : "available",
      recommendation:
        architecture === "x64"
          ? "Install a native ARM64 build before using this tool on Apple Silicon."
          : null,
    });
  }
  const editors = [];
  if (process.platform === "darwin")
    for (const base of [
      "/Applications",
      path.join(os.homedir(), "Applications"),
    ])
      for (const name of [
        "Visual Studio Code.app",
        "Visual Studio Code - Insiders.app",
      ]) {
        const file = path.join(base, name);
        try {
          if ((await fs.stat(file)).isDirectory()) editors.push(file);
        } catch {}
      }
  const stat = await fs.statfs(os.homedir());
  return {
    platform: process.platform,
    architecture: process.arch,
    node: process.versions.node,
    release: os.release(),
    memoryBytes: os.totalmem(),
    availableStorageBytes: Number(stat.bavail) * Number(stat.bsize),
    directories,
    tools,
    editors,
    networkTransfer:
      "TLS pairing; manual address; experimental until physical two-Mac validation",
  };
}
