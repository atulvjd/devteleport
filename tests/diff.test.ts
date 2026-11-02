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
const snap = async (root, output, name, format = 1) =>
  (await capture({ root, name, output, password, format })).output;

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

test("works with streaming format 2 snapshots", async (t) => {
  const { temp, root } = await fixture(t);
  const v2 = await snap(root, temp, "v2", 2);
  assert.equal((await fs.readFile(v2)).subarray(0, 4).toString(), "DTP2");
  assert.equal(
    (await diffSnapshotWithDirectory(v2, root, password)).identical,
    true,
  );
  await fs.writeFile(path.join(root, "edit.txt"), "after\n");
  const r = await diffSnapshotWithDirectory(v2, root, password);
  assert.deepEqual(r.modified, [{ path: "edit.txt", reasons: ["content"] }]);
  const v1 = await snap(root, temp, "v1", 1);
  const across = await diffSnapshots(v2, v1, password);
  assert.deepEqual(
    across.modified.map((m) => m.path),
    ["edit.txt"],
  );
});

test("files skipped for embedded credentials are not reported as added", async (t) => {
  const { temp, root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "notes.txt"),
    "key AKIA" + "ABCDEFGHIJKLMNOP\n",
  );
  const file = await snap(root, temp, "secret");
  const r = await diffSnapshotWithDirectory(file, root, password);
  assert.equal(r.identical, true);
});

for (const format of [1, 2] as const)
  test(`format ${format}: directory diff honors explicit capture exclusions before traversing ignored data`, async (t) => {
    const { temp, root } = await fixture(t);
    await fs.mkdir(path.join(root, "manual-cache"));
    await fs.writeFile(
      path.join(root, "manual-cache", "state.txt"),
      "excluded data",
    );
    const archive = await capture({
      root,
      output: temp,
      name: "manual-" + format,
      password,
      format,
      includeIgnored: true,
      exclusions: ["manual-cache"],
    });
    // An excluded subtree may later become huge, unreadable or contain unsafe
    // links. Diff must preserve capture's boundary instead of inspecting it.
    await fs.symlink(temp, path.join(root, "manual-cache", "external"));
    assert(
      (await diffSnapshotWithDirectory(archive.output, root, password))
        .identical,
    );
    await fs.writeFile(path.join(root, "keep.txt"), "actual source change");
    const result = await diffSnapshotWithDirectory(
      archive.output,
      root,
      password,
    );
    assert.deepEqual(result.modified, [
      { path: "keep.txt", reasons: ["content"] },
    ]);
    assert.deepEqual(result.added, []);
  });
