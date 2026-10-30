import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { capture, restore } from "../packages/core/index.ts";
const exec = promisify(execFile);
test("Express runs after source removal and approved independent dependency install", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-express-"));
  let server;
  t.after(async () => {
    if (server) {
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
    }
    await fs.rm(temp, { recursive: true, force: true });
  });
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  await fs.copyFile(
    "examples/hello/package.json",
    path.join(root, "package.json"),
  );
  const app =
    "import express from 'express';const app=express();app.get('/',(q,r)=>r.json({message:'independent'}));const s=app.listen(0,'127.0.0.1',()=>console.log(s.address().port));";
  await fs.writeFile(path.join(root, "server.mjs"), app);
  await exec(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--fetch-retries=0",
      "--fetch-timeout=20000",
    ],
    { cwd: root },
  );
  await fs.writeFile(path.join(root, ".gitignore"), "node_modules/\n");
  const git = (args) => exec("git", args, { cwd: root });
  await git(["init", "-q"]);
  await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.invalid"]);
  await git(["add", "."]);
  await git(["commit", "-qm", "initial"]);
  await fs.appendFile(
    path.join(root, "server.mjs"),
    "\n// uncommitted change\n",
  );
  await fs.writeFile(path.join(root, "untracked"), "preserved");
  const password = "express independent restore";
  const a = await capture({ root, name: "express", output: temp, password });
  await fs.rm(root, { recursive: true });
  const target = path.join(temp, "restored");
  const result = await restore(a.output, {
    target,
    password,
    install: true,
    approveExecution: true,
  });
  assert(result.verification.ok);
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: target,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Express startup timeout")),
      15000,
    );
    server.once("error", reject);
    server.stdout.once("data", (chunk) => {
      clearTimeout(timer);
      resolve(Number(chunk.toString().trim()));
    });
    server.once("exit", (code) => {
      if (code) reject(new Error("Express exited before startup"));
    });
  });
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.deepEqual(await response.json(), { message: "independent" });
  assert.equal(
    await fs.readFile(path.join(target, "untracked"), "utf8"),
    "preserved",
  );
  const status = (await exec("git", ["status", "--porcelain"], { cwd: target }))
    .stdout;
  assert(status.includes(" M server.mjs"));
  assert(status.includes("?? untracked"));
});
