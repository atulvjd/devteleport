import * as sync from "node:fs";
import path from "node:path";
const nativeCache = new Map<string, boolean>();
function assertNative(file: string, env: NodeJS.ProcessEnv | undefined) {
  if (process.platform !== "darwin" || process.arch !== "arm64") return;
  const directories = (env?.PATH ?? process.env.PATH ?? "").split(
      path.delimiter,
    ),
    resolved = path.isAbsolute(file)
      ? file
      : directories
          .map((directory) => path.join(directory, file))
          .find((candidate) => {
            try {
              return sync.statSync(candidate).isFile();
            } catch {
              return false;
            }
          });
  if (!resolved) return;
  const fd = sync.openSync(resolved, "r"),
    bytes = Buffer.alloc(4096);
  let count = 0;
  try {
    count = sync.readSync(fd, bytes, 0, bytes.length, 0);
  } finally {
    sync.closeSync(fd);
  }
  const magic = bytes.subarray(0, 4).toString("hex");
  let native = true;
  if (["cffaedfe", "cefaedfe"].includes(magic))
    native = bytes.readUInt32LE(4) === 0x0100000c;
  else if (["feedfacf", "feedface"].includes(magic))
    native = bytes.readUInt32BE(4) === 0x0100000c;
  else if (["cafebabe", "cafebabf", "bebafeca", "bfbafeca"].includes(magic)) {
    const little = magic.startsWith("be") || magic.startsWith("bf"),
      read = (offset: number) =>
        little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset),
      records = read(4),
      stride = ["cafebabf", "bfbafeca"].includes(magic) ? 32 : 20;
    native = false;
    for (let i = 0; i < records && 8 + i * stride + 4 <= count; i++)
      if (read(8 + i * stride) === 0x0100000c) native = true;
  }
  nativeCache.set(resolved, native);
  if (!native)
    throw new Error(
      "Tool is Intel-only: " +
        path.basename(file) +
        ". Install a native ARM64 executable.",
    );
  if (["npm", "pnpm", "yarn"].includes(path.basename(file)))
    assertNative("node", env);
}
import {
  spawn,
  type ChildProcess,
  type ExecFileOptions,
} from "node:child_process";
let cancelled = false;
export function throwIfCancelled() {
  if (cancelled)
    throw new Error(
      "Operation cancelled; incomplete private output was not published.",
    );
}
const children = new Set<ChildProcess>(),
  cleanups = new Set<() => Promise<unknown>>();
function report(type: string, pid: number | undefined) {
  const parent = (
    process as typeof process & {
      parentPort?: { postMessage: (value: unknown) => void };
    }
  ).parentPort;
  if (pid)
    parent?.postMessage({ type, pid, group: process.platform !== "win32" });
}
export function trackChild(child: ChildProcess) {
  children.add(child);
  report("tool-start", child.pid);
  child.once("close", () => {
    children.delete(child);
    report("tool-exit", child.pid);
  });
  return child;
}
export function registerCleanup(cleanup: () => Promise<unknown>) {
  cleanups.add(cleanup);
  return () => cleanups.delete(cleanup);
}
function kill(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {}
}
export function spawnBuffered(
  file: string,
  args: string[],
  options: ToolOptions,
  callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void,
) {
  assertNative(file, options.env);
  const child = trackChild(
    spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      uid: options.uid,
      gid: options.gid,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  let out = 0,
    err = 0,
    error: Error | null = null,
    done = false;
  const maximum = options.maxBuffer ?? 16 * 1024 * 1024;
  const aborted = () => {
    error = new Error("Tool operation aborted");
    kill(child, "SIGKILL");
  };
  if (options.signal?.aborted) aborted();
  else options.signal?.addEventListener("abort", aborted, { once: true });
  const timer = options.timeout
    ? setTimeout(() => {
        error = new Error("Tool timed out");
        kill(child, "SIGKILL");
      }, options.timeout)
    : undefined;
  child.stdout!.on("data", (chunk: Buffer) => {
    out += chunk.length;
    if (out > maximum) {
      error = new Error("Tool output exceeds limit");
      kill(child, "SIGKILL");
    } else {
      stdout.push(chunk);
      options.onOutput?.("stdout", chunk);
    }
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    err += chunk.length;
    if (err > maximum) {
      error = new Error("Tool diagnostics exceed limit");
      kill(child, "SIGKILL");
    } else {
      stderr.push(chunk);
      options.onOutput?.("stderr", chunk);
    }
  });
  child.once("error", (caught) => {
    error = caught;
  });
  child.once("close", (code) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", aborted);
    if (code !== 0 && !error)
      error = new Error("Tool exited unsuccessfully (" + code + ")");
    if (error) kill(child, "SIGKILL");
    callback(error, Buffer.concat(stdout), Buffer.concat(stderr));
  });
  return child;
}
export type ToolOptions = ExecFileOptions & {
  detached?: boolean;
  onOutput?: (stream: "stdout" | "stderr", chunk: Buffer) => void;
};
export function execText(
  file: string,
  args: string[],
  options: ToolOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnBuffered(file, args, options, (error, stdout, stderr) =>
      error
        ? reject(error)
        : resolve({
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8"),
          }),
    );
    child.stdin?.end();
  });
}
export async function shutdownChildren() {
  cancelled = true;
  const active = [...children];
  for (const child of active) kill(child, "SIGTERM");
  await Promise.race([
    Promise.allSettled([...cleanups].map((cleanup) => cleanup())),
    new Promise((resolve) => setTimeout(resolve, 4000).unref()),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const child of new Set([...active, ...children])) kill(child, "SIGKILL");
}
