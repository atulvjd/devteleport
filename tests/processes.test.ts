import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnBuffered, shutdownChildren } from "../packages/core/processes.ts";
test("cancellation terminates a supervised tool and its descendant process group", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-process-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, "parent.cjs");
  await fs.writeFile(
    file,
    "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000);",
  );
  let finish;
  const exited = new Promise((resolve) => (finish = resolve));
  const child = spawnBuffered(
    process.execPath,
    [file],
    { timeout: 10000 },
    () => finish(),
  );
  child.stdin.end();
  const descendant = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("child startup timeout")),
      5000,
    );
    child.stdout.once("data", (bytes) => {
      clearTimeout(timer);
      // FORCE_COLOR (set by the test runner in a colour terminal) wraps the
      // printed number in ANSI codes; strip them before parsing.
      resolve(
        Number(bytes.toString().replace(/\x1b\[[0-9;]*m/g, "").trim()),
      );
    });
  });
  assert(Number.isInteger(descendant));
  await shutdownChildren();
  await exited;
  let alive = true;
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(descendant, 0);
    } catch (error) {
      if (error.code === "ESRCH") {
        alive = false;
        break;
      }
      throw error;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(
    alive,
    false,
    "A descendant survived process-group cancellation",
  );
});
test(
  "Apple Silicon refuses an Intel-only native tool before executing it",
  { skip: process.platform !== "darwin" || process.arch !== "arm64" },
  async (t) => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-arch-"));
    t.after(() => fs.rm(temp, { recursive: true, force: true }));
    const executable = path.join(temp, "intel-only"),
      header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(0x01000007, 4);
    await fs.writeFile(executable, header, { mode: 0o755 });
    assert.throws(
      () => spawnBuffered(executable, [], {}, () => {}),
      /Intel-only/,
    );
  },
);
