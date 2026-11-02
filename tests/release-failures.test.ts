import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodeFs from "node:fs";
import { Writable } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import os from "node:os";
import { capture, restore } from "../packages/core/index.ts";
import { snapshotMetadata } from "../packages/core/stream-v2.ts";

const password = "release failure fixture passphrase";
const fault = (code: string) =>
  Object.assign(new Error("injected fixture " + code), { code });
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-release-fault-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "a.txt"), "first saved file");
  await fs.writeFile(path.join(root, "b.txt"), "second saved file");
  return { temp, root };
}
function trackAuthentication(t) {
  const dirs: string[] = [];
  const original = fs.mkdtemp;
  t.mock.method(
    fs,
    "mkdtemp",
    async (...args: Parameters<typeof fs.mkdtemp>) => {
      const dir = await original(...args);
      if (
        String(args[0]).startsWith(path.join(os.tmpdir(), ".devteleport-v2-"))
      )
        dirs.push(String(dir));
      return dir;
    },
  );
  t.after(async () => {
    for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
  });
  return dirs;
}

test("authentication journal disk failure cleans its private stage and preserves a readable archive", async (t) => {
  const { root, temp } = await fixture(t);
  const archive = await capture({
    root,
    output: temp,
    name: "journal",
    format: 2,
    password,
  });
  const bytes = await fs.readFile(archive.output);
  const dirs = trackAuthentication(t);
  const original = fs.open;
  const injected = t.mock.method(fs, "open", async (file, ...args) => {
    if (String(file).includes("journal.json.tmp-")) throw fault("ENOSPC");
    return original(file, ...args);
  });
  await assert.rejects(snapshotMetadata(archive.output, password), {
    code: "ENOSPC",
  });
  assert.equal(dirs.length, 1);
  await assert.rejects(fs.stat(dirs[0]), { code: "ENOENT" });
  assert.deepEqual(await fs.readFile(archive.output), bytes);
  injected.mock.restore();
  assert.equal(
    (await snapshotMetadata(archive.output, password)).files.length,
    2,
  );
});

test("authentication payload ENOSPC reports storage failure and cleans plaintext staging", async (t) => {
  const { root, temp } = await fixture(t);
  const archive = await capture({
    root,
    output: temp,
    name: "storage",
    format: 2,
    password,
  });
  const dirs = trackAuthentication(t);
  const original = nodeFs.createWriteStream;
  const injected = t.mock.method(
    nodeFs,
    "createWriteStream",
    (file, ...args) => {
      if (path.basename(String(file)) === "payload")
        return new Writable({
          write(_chunk, _encoding, callback) {
            callback(fault("ENOSPC"));
          },
        });
      return original(file, ...args);
    },
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      snapshotMetadata(archive.output, password),
      (error) => {
        assert.match(error.message, /storage.*full|free.*space/i);
        assert(!/incorrect passphrase|damaged archive/i.test(error.message));
        return true;
      },
    );
    assert.equal(dirs.length, 1);
    await assert.rejects(fs.stat(dirs[0]), { code: "ENOENT" });
  } finally {
    injected.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(
    (await snapshotMetadata(archive.output, password)).files.length,
    2,
  );
});

test("disk-space preflight refuses capture without publishing files or altering the source", async (t) => {
  const { root, temp } = await fixture(t);
  const original = fs.statfs;
  const injected = t.mock.method(fs, "statfs", async (file) => ({
    ...(await original(file)),
    bavail: 0,
  }));
  await assert.rejects(
    capture({ root, output: temp, name: "full", format: 2, password }),
    /free storage/,
  );
  assert.deepEqual(await fs.readdir(temp), ["source"]);
  assert.equal(
    await fs.readFile(path.join(root, "a.txt"), "utf8"),
    "first saved file",
  );
  injected.mock.restore();
  assert(
    (await capture({ root, output: temp, name: "full", format: 2, password }))
      .output,
  );
});

test("capture publication disk failure leaves existing archives intact and permits retry", async (t) => {
  const { root, temp } = await fixture(t);
  const previous = path.join(temp, "existing.dtp");
  await fs.writeFile(previous, "existing encrypted fixture");
  const original = fs.link;
  const injected = t.mock.method(fs, "link", async (source, target) => {
    if (target === path.join(temp, "publish.dtp")) throw fault("ENOSPC");
    return original(source, target);
  });
  await assert.rejects(
    capture({ root, output: temp, name: "publish", format: 2, password }),
    { code: "ENOSPC" },
  );
  assert.deepEqual((await fs.readdir(temp)).sort(), ["existing.dtp", "source"]);
  assert.equal(
    await fs.readFile(previous, "utf8"),
    "existing encrypted fixture",
  );
  injected.mock.restore();
  assert(
    (
      await capture({
        root,
        output: temp,
        name: "publish",
        format: 2,
        password,
      })
    ).output,
  );
});

test("failed restore publication removes only its claimed destination and permits a clean retry", async (t) => {
  const { root, temp } = await fixture(t);
  const archive = await capture({
    root,
    output: temp,
    name: "restore",
    format: 2,
    password,
  });
  const target = path.join(temp, "target");
  const neighbour = path.join(temp, "other-project");
  await fs.mkdir(neighbour);
  await fs.writeFile(path.join(neighbour, "keep.txt"), "never overwrite");
  const original = fs.rename;
  const injected = t.mock.method(fs, "rename", async (source, destination) => {
    if (destination === path.join(target, "b.txt")) throw fault("EIO");
    return original(source, destination);
  });
  await assert.rejects(restore(archive.output, { target, password }), {
    code: "EIO",
  });
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
  assert.equal(
    await fs.readFile(path.join(neighbour, "keep.txt"), "utf8"),
    "never overwrite",
  );
  assert(
    !(await fs.readdir(temp)).some((name) =>
      name.startsWith(".devteleport-v2-"),
    ),
  );
  injected.mock.restore();
  assert((await restore(archive.output, { target, password })).verification.ok);
});
