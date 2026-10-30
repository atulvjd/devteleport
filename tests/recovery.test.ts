import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { cleanupRecovery } from "../packages/core/recovery.ts";
test("recovery cleanup is a preview until approved, refuses active processes and never cleans arbitrary project directories", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-recovery-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, ".devteleport-v2-example");
  await fs.mkdir(root, { mode: 0o700 });
  const journal = path.join(root, "journal.json");
  await fs.writeFile(
    journal,
    JSON.stringify({
      owner: "devteleport",
      pid: process.pid,
      formatVersion: 2,
      operation: "capture",
      status: "encrypting",
    }),
  );
  await assert.rejects(cleanupRecovery(root, true), /still active/);
  await fs.writeFile(
    journal,
    JSON.stringify({
      owner: "devteleport",
      pid: 99999999,
      formatVersion: 2,
      operation: "capture",
      status: "encrypting",
    }),
  );
  const preview = await cleanupRecovery(root, false);
  assert.equal(preview.approved, false);
  await fs.stat(root);
  assert((await cleanupRecovery(root, true)).cleaned);
  await assert.rejects(fs.stat(root));
  const project = path.join(temp, "user-project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "source"), "preserved");
  await assert.rejects(cleanupRecovery(project, true), /restricted/);
  assert.equal(
    await fs.readFile(path.join(project, "source"), "utf8"),
    "preserved",
  );
});

test("failed partial cleanup preserves its journal and supports an approved retry", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-recovery-retry-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, ".devteleport-v2-retry");
  const partial = path.join(
    temp,
    ".snapshot.dtp.partial-12345678-1234-1234-1234-123456789abc",
  );
  await fs.mkdir(root, { mode: 0o700 });
  const journal = path.join(root, "journal.json");
  const record = {
    owner: "devteleport",
    pid: 99999999,
    formatVersion: 2,
    operation: "capture",
    status: "encrypting",
    partial,
  };
  await fs.writeFile(journal, JSON.stringify(record));
  await fs.writeFile(partial, "incomplete encrypted data");
  const originalRm = fs.rm;
  const injected = t.mock.method(fs, "rm", async (file, options) => {
    if (file === partial)
      throw Object.assign(new Error("injected partial removal failure"), {
        code: "EACCES",
      });
    return originalRm(file, options);
  });
  await assert.rejects(
    cleanupRecovery(root, true),
    /injected partial removal failure/,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(journal, "utf8")), record);
  assert.equal(await fs.readFile(partial, "utf8"), "incomplete encrypted data");
  injected.mock.restore();
  assert.equal((await cleanupRecovery(root, false)).artifacts.length, 2);
  assert.equal((await cleanupRecovery(root, true)).cleaned, true);
  await assert.rejects(fs.stat(root), { code: "ENOENT" });
  await assert.rejects(fs.stat(partial), { code: "ENOENT" });
});

test("failed staging cleanup remains retryable after its partial was removed", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-recovery-stage-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, ".devteleport-v2-retry");
  const partial = path.join(
    temp,
    ".snapshot.dtp.partial-12345678-1234-1234-1234-123456789abc",
  );
  const finalArchive = path.join(temp, "snapshot.dtp");
  await fs.mkdir(root, { mode: 0o700 });
  await fs.writeFile(
    path.join(root, "journal.json"),
    JSON.stringify({
      owner: "devteleport",
      pid: 99999999,
      formatVersion: 2,
      operation: "capture",
      partial,
    }),
  );
  await fs.writeFile(partial, "partial");
  await fs.writeFile(finalArchive, "preserve existing archive");
  const originalRm = fs.rm;
  const injected = t.mock.method(fs, "rm", async (file, options) => {
    if (file === root)
      throw Object.assign(new Error("injected stage removal failure"), {
        code: "EACCES",
      });
    return originalRm(file, options);
  });
  await assert.rejects(
    cleanupRecovery(root, true),
    /injected stage removal failure/,
  );
  await assert.rejects(fs.stat(partial), { code: "ENOENT" });
  injected.mock.restore();
  assert.deepEqual((await cleanupRecovery(root, false)).artifacts, [root]);
  assert.equal((await cleanupRecovery(root, true)).cleaned, true);
  assert.equal(
    await fs.readFile(finalArchive, "utf8"),
    "preserve existing archive",
  );
});
