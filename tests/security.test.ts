import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  capture,
  restore,
  verify,
  verifyFromSnapshot,
  recover,
} from "../packages/core/index.ts";
import {
  generateSigningKeys,
  signSnapshot,
  verifySignature,
} from "../packages/core/signatures.ts";
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-hardening-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  return { temp, root };
}
const password = "security integration password";
test("embedded credentials and additional credential directories excluded with review records", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(
    path.join(root, "innocent.txt"),
    "-----BEGIN PRIVATE KEY-----\nexample",
  );
  await fs.mkdir(path.join(root, ".docker"));
  await fs.writeFile(path.join(root, ".docker", "config.json"), "secret");
  const result = await capture({
    root,
    name: "secrets",
    output: temp,
    password,
  });
  assert(result.omitted.some((x) => x.startsWith("innocent.txt")));
  assert(result.omitted.includes(".docker"));
});
test("authenticated archive verification detects forged local inventory; publication and recovery journal", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "source");
  const a = await capture({ root, name: "auth", output: temp, password });
  assert(!(await recover(temp)).entries.length);
  const target = path.join(temp, "target");
  await restore(a.output, { target, password });
  assert.equal((await recover(target)).entries[0].status, "complete");
  await fs.writeFile(path.join(target, "a"), "changed");
  const inventory = path.join(target, ".devteleport", "inventory.json");
  const m = JSON.parse(await fs.readFile(inventory, "utf8"));
  m.files = [];
  await fs.writeFile(inventory, JSON.stringify(m));
  assert((await verify(target)).ok);
  assert(!(await verifyFromSnapshot(target, a.output, password)).ok);
  await fs.writeFile(
    path.join(temp, ".auth.dtp.partial-example"),
    "incomplete",
  );
  assert.equal((await recover(temp)).entries.length, 1);
});
test("Ed25519 signature validates trusted key and rejects archive tampering and wrong signers", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "signed");
  const a = await capture({ root, name: "signed", output: temp, password });
  const keys = await generateSigningKeys(path.join(temp, "signer"), password);
  await signSnapshot(a.output, keys.privateKey, password);
  assert((await verifySignature(a.output, keys.publicKey)).verified);
  const other = await generateSigningKeys(path.join(temp, "other"), password);
  await assert.rejects(
    verifySignature(a.output, other.publicKey),
    /verification failed/,
  );
  const bytes = await fs.readFile(a.output);
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(a.output, bytes);
  await assert.rejects(
    verifySignature(a.output, keys.publicKey),
    /verification failed/,
  );
});
test("malformed or unknown configuration is refused", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "devteleport.json"),
    JSON.stringify({
      databases: [
        { name: "app", connectionEnv: "DTP", password: "must-not-embed" },
      ],
    }),
  );
  await assert.rejects(
    capture({ root, dryRun: true }),
    /Unknown adapter field/,
  );
});
test("missing Git LFS objects are refused; complete objects survive capture and restore", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const crypto = await import("node:crypto");
  const { root, temp } = await fixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  const content = Buffer.from("actual binary content"),
    hash = crypto.createHash("sha256").update(content).digest("hex");
  await fs.writeFile(
    path.join(root, "asset.bin"),
    `version https://git-lfs.github.com/spec/v1\noid sha256:${hash}\nsize ${content.length}\n`,
  );
  git("add", ".");
  git("commit", "-qm", "LFS pointer");
  await assert.rejects(capture({ root, dryRun: true }), /LFS object.*missing/);
  const object = path.join(
    root,
    ".git",
    "lfs",
    "objects",
    hash.slice(0, 2),
    hash.slice(2, 4),
    hash,
  );
  await fs.mkdir(path.dirname(object), { recursive: true });
  await fs.writeFile(object, content);
  const a = await capture({ root, name: "lfs", output: temp, password });
  const target = path.join(temp, "restored");
  await restore(a.output, { target, password });
  assert.deepEqual(
    await fs.readFile(
      path.join(
        target,
        ".git",
        "lfs",
        "objects",
        hash.slice(0, 2),
        hash.slice(2, 4),
        hash,
      ),
    ),
    content,
  );
});

test("abrupt capture interruption never publishes a damaged final snapshot", async (t) => {
  const { spawn } = await import("node:child_process");
  const crypto = await import("node:crypto");
  const { snapshotMetadata: readSnapshot } =
    await import("../packages/core/stream-v2.ts");
  const { root, temp } = await fixture(t);
  await fs.writeFile(
    path.join(root, "random.bin"),
    crypto.randomBytes(16 * 1024 * 1024),
  );
  const child = spawn(
    process.execPath,
    [
      path.resolve("apps/cli/main.ts"),
      "capture",
      "--root",
      root,
      "--name",
      "interrupted",
      "--output",
      temp,
    ],
    {
      env: { ...process.env, DEVTELEPORT_PASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let interrupted = false;
  const watcher = setInterval(async () => {
    const files = await fs.readdir(temp).catch(() => []);
    if (files.some((file) => file.includes(".dtp.partial-"))) {
      interrupted = true;
      child.kill("SIGKILL");
    }
  }, 1);
  let stderr = "";
  child.stderr.on("data", (data) => (stderr += data));
  child.stdout.resume();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("capture interruption timeout"));
    }, 30000);
    child.once("error", reject);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
  clearInterval(watcher);
  assert(interrupted, stderr);
  try {
    const final = await readSnapshot(
      path.join(temp, "interrupted.dtp"),
      password,
    );
    assert(final.files.some((f) => f.path === "random.bin"));
  } catch (error) {
    assert.equal(error.code, "ENOENT");
  }
});
test("CLI signing and archive-backed verification execute through strict command parsing", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "cli signed");
  const a = await capture({ root, name: "cli-signed", output: temp, password });
  const cli = path.resolve("apps/cli/main.ts"),
    env = { ...process.env, DEVTELEPORT_PASSWORD: password };
  const call = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  const keys = call("keygen", "--target", path.join(temp, "key"));
  call("sign", a.output, "--key", keys.privateKey);
  assert(call("check-signature", a.output, "--key", keys.publicKey).verified);
  const target = path.join(temp, "restored");
  call("restore", a.output, "--target", target, "--verify-key", keys.publicKey);
  assert(call("verify", target, "--snapshot", a.output).ok);
  assert.throws(() => call("unknown-command"));
});
test("inspection never executes a repository fsmonitor command", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const { inspect } = await import("../packages/core/index.ts");
  const { root, temp } = await fixture(t);
  const marker = path.join(temp, "fsmonitor-ran");
  execFileSync("git", ["init", "-q"], { cwd: root });
  const script = path.join(temp, "monitor.sh");
  await fs.writeFile(script, '#!/bin/sh\ntouch "' + marker + '"\n', {
    mode: 0o755,
  });
  execFileSync("git", ["config", "core.fsmonitor", script], { cwd: root });
  await inspect(root);
  await assert.rejects(fs.stat(marker));
});
test("corrupt Git objects and partial clones fail before snapshot publication", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const { root, temp } = await fixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(root, "a"), "git integrity");
  git("add", ".");
  git("commit", "-qm", "initial");
  git("config", "extensions.partialClone", "origin");
  await assert.rejects(
    capture({ root, name: "partial", output: temp, password }),
    /Partial Git clones/,
  );
  git("config", "--unset", "extensions.partialClone");
  const oid = git("rev-parse", "HEAD:a");
  const object = path.join(
    root,
    ".git",
    "objects",
    oid.slice(0, 2),
    oid.slice(2),
  );
  await fs.chmod(object, 0o600);
  await fs.writeFile(object, "damaged");
  await assert.rejects(
    capture({ root, name: "corrupt", output: temp, password }),
    /Git integrity check failed/,
  );
  await assert.rejects(fs.stat(path.join(temp, "corrupt.dtp")));
});
