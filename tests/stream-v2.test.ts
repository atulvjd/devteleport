import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  capture,
  restore,
  readSnapshot,
  verifyFromSnapshot,
} from "../packages/core/index.ts";
import { hashFile, snapshotMetadata } from "../packages/core/stream-v2.ts";
const password = "streaming format two passphrase";
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-v2-test-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  return { temp, root };
}
test("format 1 archives remain readable and restorable", async (t) => {
  const { temp, root } = await fixture(t);
  await fs.writeFile(path.join(root, "hello"), "old format");
  const a = await capture({
    root,
    name: "legacy",
    output: temp,
    password,
    format: 1,
  });
  assert.equal((await readSnapshot(a.output, password)).formatVersion, 1);
  const r = await restore(a.output, {
    target: path.join(temp, "legacy"),
    password,
  });
  assert(r.verification.ok);
});
test("streaming format 2 restores a large file, Git staged/unstaged state and Unicode paths after source removal", async (t) => {
  const { temp, root } = await fixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(root, "tracked"), "committed");
  git("add", ".");
  git("commit", "-qm", "base");
  await fs.writeFile(path.join(root, "tracked"), "staged");
  git("add", ".");
  await fs.writeFile(path.join(root, "tracked"), "unstaged");
  await fs.writeFile(path.join(root, "résumé file.txt"), "Unicode data");
  await fs.symlink("tracked", path.join(root, "link"));
  const file = await fs.open(path.join(root, "large.bin"), "wx");
  const block = crypto.randomBytes(1024 * 1024);
  for (let i = 0; i < 80; i++) await file.write(block);
  await file.close();
  const expected = await hashFile(path.join(root, "large.bin")),
    before = git("status", "--porcelain"),
    staged = git("diff", "--cached");
  const a = await capture({
    root,
    name: "stream",
    output: temp,
    password,
    format: 2,
  });
  assert.equal(a.formatVersion, 2);
  assert.equal((await snapshotMetadata(a.output, password)).formatVersion, 2);
  await fs.rm(root, { recursive: true });
  const target = path.join(temp, "independent");
  const plan = await restore(a.output, { target, password, dryRun: true });
  assert.equal(plan.formatVersion, 2);
  await assert.rejects(fs.stat(target));
  const result = await restore(a.output, { target, password });
  assert(result.verification.ok);
  assert.equal(await hashFile(path.join(target, "large.bin")), expected);
  assert.equal(
    await fs.readFile(path.join(target, "résumé file.txt"), "utf8"),
    "Unicode data",
  );
  const after = execFileSync("git", ["status", "--porcelain"], {
    cwd: target,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((s) => !s.includes(".devteleport/"))
    .join("\n");
  assert.equal(after, before);
  assert.equal(
    execFileSync("git", ["diff", "--cached"], {
      cwd: target,
      encoding: "utf8",
    }).trim(),
    staged,
  );
  assert((await verifyFromSnapshot(target, a.output, password)).ok);
  await assert.rejects(
    restore(a.output, { target, password }),
    /already exists/,
  );
});
test("format 2 authenticates before extraction and refuses wrong passwords, tampering and truncated input", async (t) => {
  const { temp, root } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "test");
  const a = await capture({
    root,
    name: "auth",
    output: temp,
    password,
    format: 2,
  });
  const target = path.join(temp, "forbidden");
  await assert.rejects(
    restore(a.output, { target, password: "wrong" }),
    /authenticate/,
  );
  await assert.rejects(fs.stat(target));
  const handle = await fs.open(a.output, "r+");
  await handle.write(Buffer.from([255]), 0, 1, 40);
  await handle.close();
  await assert.rejects(restore(a.output, { target, password }), /authenticate/);
  await assert.rejects(fs.stat(target));
  await fs.truncate(a.output, 40);
  await assert.rejects(restore(a.output, { target, password }), /size/);
});
test("format 2 enforces path and checksum validation even for authenticated malicious metadata", async (t) => {
  const { temp, root } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "test");
  const a = await capture({
    root,
    name: "source",
    output: temp,
    password,
    format: 2,
  });
  const metadata = await snapshotMetadata(a.output, password);
  async function forge(name, mutate) {
    const m = structuredClone(metadata);
    mutate(m);
    const meta = Buffer.from(JSON.stringify(m)),
      length = Buffer.alloc(4);
    length.writeUInt32BE(meta.length);
    const header = Buffer.concat([
        Buffer.from("DTP2"),
        crypto.randomBytes(16),
        crypto.randomBytes(12),
      ]),
      key = crypto.scryptSync(password, header.subarray(4, 20), 32, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      }),
      cipher = crypto.createCipheriv("aes-256-gcm", key, header.subarray(20));
    cipher.setAAD(header);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.concat([length, meta, Buffer.from("test")])),
      cipher.final(),
    ]);
    const file = path.join(temp, name + ".dtp");
    await fs.writeFile(
      file,
      Buffer.concat([header, encrypted, cipher.getAuthTag()]),
    );
    return file;
  }
  const bad = await forge("traversal", (m) => (m.files[0].path = "../escape"));
  await assert.rejects(
    restore(bad, { target: path.join(temp, "unsafe"), password }),
    /Unsafe/,
  );
  const wrong = await forge(
    "checksum",
    (m) => (m.files[0].checksum = "0".repeat(64)),
  );
  await assert.rejects(
    restore(wrong, { target: path.join(temp, "unsafe"), password }),
    /checksum/,
  );
  await assert.rejects(fs.stat(path.join(temp, "unsafe")));
});
