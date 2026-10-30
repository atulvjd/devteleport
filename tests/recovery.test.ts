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
