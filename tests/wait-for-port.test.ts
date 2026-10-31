import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { waitForPort, waitForNumberLine } from "./wait-for-port.ts";

function child(t, script: string) {
  const process = spawn(globalThis.process.execPath, ["-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (process.exitCode === null && process.signalCode === null)
      process.kill();
  });
  return process;
}
test("startup parser waits for a whole coloured stdout line across chunks and ignores numeric stderr", async (t) => {
  const server = child(
    t,
    "process.stderr.write('23456\\n');process.stdout.write('warning\\n\\x1b[33m12');setTimeout(()=>process.stdout.write('345\\x1b[39m\\n'),30);",
  );
  assert.equal(await waitForPort(server, "server"), 12345);
  assert.equal(server.stdout.listenerCount("data"), 0);
  assert.equal(server.stderr.listenerCount("data"), 0);
  assert.equal(server.listenerCount("error"), 0);
});
test("startup parser rejects early clean exit and reports stderr rather than using it as a port", async (t) => {
  const server = child(t, "console.error('12345');process.exit(0)");
  await assert.rejects(
    waitForPort(server, "server"),
    /exited before startup[\s\S]*Stderr:\n12345/,
  );
});
test("startup parser ignores invalid port ranges and returns a valid later port", async (t) => {
  const server = child(
    t,
    "console.log('0\\n65536\\n99999999999999999\\n54321');",
  );
  assert.equal(await waitForPort(server, "server"), 54321);
});
test("startup parser times out with diagnostic output and removes its listeners", async (t) => {
  const server = child(
    t,
    "console.log('still starting');setInterval(()=>{},1000)",
  );
  await assert.rejects(
    waitForPort(server, "server", 500),
    /startup timed out[\s\S]*still starting/,
  );
  assert.equal(server.stdout.listenerCount("data"), 0);
  assert.equal(server.stderr.listenerCount("data"), 0);
});
test("numeric startup parser supports PIDs above the port limit", async (t) => {
  const server = child(t, "console.log(123456);");
  assert.equal(await waitForNumberLine(server, "PID"), 123456);
});
