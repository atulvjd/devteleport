import type { ChildProcess } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

/** Read a complete numeric stdout line, allowing terminal colours and split chunks.
 * Stderr is diagnostic only; it must never be mistaken for a port or PID.
 */
export function waitForNumberLine(
  child: ChildProcess,
  label: string,
  { min = 1, max = Number.MAX_SAFE_INTEGER, ms = 15000 } = {},
) {
  return new Promise<number>((resolve, reject) => {
    let pending = "",
      stdout = "",
      stderr = "",
      settled = false;
    const limit = 65536;
    const cleanup = () => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("close", onClose);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onStderr);
    };
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `${label} ${why}. Stdout:\n${stdout || "(none)"}\nStderr:\n${stderr || "(none)"}`,
        ),
      );
    };
    const parse = (line: string) => {
      const value = stripVTControlCharacters(line).trim();
      if (!/^\d+$/.test(value)) return false;
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < min || number > max)
        return false;
      settled = true;
      cleanup();
      resolve(number);
      return true;
    };
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      stdout = (stdout + text).slice(-limit);
      pending += text;
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (parse(line)) return;
      }
      if (pending.length > limit) fail("printed an oversized startup line");
    };
    const onStderr = (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-limit);
    };
    const onError = (error: Error) => fail(`failed: ${error.message}`);
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      if (!parse(pending))
        fail(`exited before startup (code ${code}, signal ${signal})`);
    };
    const timer = setTimeout(() => fail("startup timed out"), ms);
    child.on("error", onError);
    child.on("close", onClose);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onStderr);
    if (!child.stdout) fail("requires piped stdout");
    else if (child.exitCode !== null || child.signalCode !== null)
      fail("already exited before startup could be observed");
  });
}

export function waitForPort(server: ChildProcess, label: string, ms = 15000) {
  return waitForNumberLine(server, label, { min: 1, max: 65535, ms });
}
