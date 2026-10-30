import type { ChildProcess } from "node:child_process";

/**
 * Waits for a test server to print its port on a line of its own.
 * Other output (warnings, logs, split chunks) is skipped, and kept for the
 * error message so a failure shows what the server actually printed.
 * Colour codes are stripped: when the test runner sets FORCE_COLOR (as it
 * does in a colour terminal), console.log(port) prints "\x1b[33m4000\x1b[39m".
 */
export function waitForPort(server: ChildProcess, label: string, ms = 15000) {
  return new Promise<number>((resolve, reject) => {
    let output = "";
    const fail = (why: string) => {
      clearTimeout(timer);
      reject(
        new Error(`${label} ${why}. Output so far:\n${output || "(none)"}`),
      );
    };
    const timer = setTimeout(() => fail("startup timed out"), ms);
    server.once("error", (error) => fail(`failed: ${error.message}`));
    const onExit = (code: number | null) =>
      fail(`exited before startup (code ${code})`);
    server.once("exit", onExit);
    server.stderr?.on("data", (chunk) => (output += chunk.toString()));
    server.stdout?.on("data", (chunk) => {
      output += chunk.toString();
      const line = output
        .split(/\r?\n/)
        .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim())
        .find((l) => /^\d{2,5}$/.test(l));
      if (line) {
        clearTimeout(timer);
        server.off("exit", onExit);
        resolve(Number(line));
      }
    });
  });
}
