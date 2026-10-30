import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { capture } from "../packages/core/index.ts";
import {
  diffEntries,
  diffSnapshots,
  diffSnapshotWithDirectory,
} from "../packages/core/diff.ts";

const password = "correct horse battery staple";
const cli = path.resolve("apps/cli/main.ts");

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-diff-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "keep.txt"), "same\n");
  await fs.writeFile(path.join(root, "edit.txt"), "before\n");
  await fs.writeFile(path.join(root, "gone.txt"), "delete me\n");
  await fs.writeFile(path.join(root, "run.sh"), "#!/bin/sh\n", { mode: 0o644 });
  await fs.symlink("keep.txt", path.join(root, "link"));
  return { temp, root };
}
const snap = async (root, output, name) =>
  (await capture({ root, name, output, password })).output;

test("unchanged folder is identical to its snapshot", async (t) => {
  const { temp, root } = await fixture(t);
  const file = await snap(root, temp, "base");
  const result = await diffSnapshotWithDirectory(file, root, password);
  assert.equal(result.identical, true);
  assert.deepEqual(result.summary, {
    added: 0,
    removed: 0,
    modified: 0,
    unchanged: result.summary.unchanged,
  });
  assert.ok(result.summary.unchanged >= 5);
});

test("detects added, removed, edited, permission and link changes", async (t) => {
  const { temp, root } = await fixture(t);
  const file = await snap(root, temp, "base");
  await fs.writeFile(path.join(root, "edit.txt"), "after\n");
  await fs.unlink(path.join(root, "gone.txt"));
  await fs.writeFile(path.join(root, "new.txt"), "hello\n");
  await fs.chmod(path.join(root, "run.sh"), 0o755);
  await fs.unlink(path.join(root, "link"));
  await fs.symlink("edit.txt", path.join(root, "link"));
  const r = await diffSnapshotWithDirectory(file, root, password);
  assert.equal(r.identical, false);
  assert.deepEqual(r.added, ["new.txt"]);
  assert.deepEqual(r.removed, ["gone.txt"]);
  const byPath = Object.fromEntries(r.modified.map((m) => [m.path, m.reasons]));
  assert.deepEqual(byPath["edit.txt"], ["content"]);
  assert.deepEqual(byPath["run.sh"], ["permissions 644 -> 755"]);
  assert.deepEqual(byPath["link"], ["link target keep.txt -> edit.txt"]);
  assert.equal(byPath["keep.txt"], undefined);
});

test("compares two snapshots and respects capture exclusions", async (t) => {
  const { temp, root } = await fixture(t);
  const first = await snap(root, temp, "first");
  await fs.writeFile(path.join(root, ".env"), "TOKEN=secret");
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, "node_modules", "dep.js"), "x");
  await fs.writeFile(path.join(root, "keep.txt"), "changed\n");
  const second = await snap(root, temp, "second");
  const r = await diffSnapshots(first, second, password);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.modified, [{ path: "keep.txt", reasons: ["content"] }]);
  // A folder diff must not report files that capture would never save.
  const live = await diffSnapshotWithDirectory(second, root, password);
  assert.equal(live.identical, true);
});

test("Git internals are summarized unless requested", async (t) => {
  const { temp, root } = await fixture(t);
  const git = (...a) => execFileSync("git", a, { cwd: root });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("add", ".");
  git("commit", "-qm", "one");
  const file = await snap(root, temp, "base");
  await fs.writeFile(path.join(root, "edit.txt"), "committed\n");
  git("commit", "-qam", "two");
  const short = await diffSnapshotWithDirectory(file, root, password);
  assert.ok(short.git.changedEntries > 0);
  assert.ok(
    ![...short.added, ...short.removed].some((p) => p.startsWith(".git")),
  );
  assert.deepEqual(
    short.modified.map((m) => m.path),
    ["edit.txt"],
  );
  const full = await diffSnapshotWithDirectory(file, root, password, {
    includeGit: true,
  });
  assert.ok(full.added.some((p) => p.startsWith(".git/objects/")));
});

test("wrong passphrase is refused", async (t) => {
  const { temp, root } = await fixture(t);
  const file = await snap(root, temp, "base");
  await assert.rejects(
    diffSnapshotWithDirectory(file, root, "wrong passphrase!!"),
    /Cannot authenticate snapshot/,
  );
});

test("type changes are reported once", () => {
  const r = diffEntries(
    [
      {
        path: "a",
        type: "file",
        mode: 0o644,
        size: 1,
        checksum: "x",
        data: "",
      },
    ],
    [{ path: "a", type: "directory", mode: 0o755 }],
    { from: "old", to: "new" },
  );
  assert.deepEqual(r.modified, [
    { path: "a", reasons: ["type file -> directory"] },
  ]);
});

test("CLI diff exits 0 when identical and 2 when changed", async (t) => {
  const { temp, root } = await fixture(t);
  const file = await snap(root, temp, "base");
  const env = { ...process.env, DEVTELEPORT_PASSWORD: password };
  const run = () =>
    spawnSync(process.execPath, [cli, "diff", file, root], {
      env,
      encoding: "utf8",
    });
  let out = run();
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).identical, true);
  await fs.writeFile(path.join(root, "new.txt"), "x");
  out = run();
  assert.equal(out.status, 2, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout).added, ["new.txt"]);
  out = spawnSync(process.execPath, [cli, "diff"], { env, encoding: "utf8" });
  assert.equal(out.status, 1);
});
