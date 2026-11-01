import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  capture,
  restore,
  verifyFromSnapshot,
  validateManifest,
} from "../packages/core/index.ts";
import { snapshotMetadata } from "../packages/core/stream-v2.ts";
import { diffSnapshotWithDirectory } from "../packages/core/diff.ts";

const password = "include ignored fixture passphrase",
  secret = "private-local-env-fixture-value";
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-ignored-")),
    root = path.join(temp, "project");
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.mkdir(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const files = {
    ".gitignore": ".env*\nprivate/\ncache/\nnode_modules/\n",
    ".env": "APP_SECRET=" + secret + "\n",
    ".env.local": "LOCAL_OPTION=fixture-local-value\n",
    "private/config.json": '{"token":"fixture-private-config"}',
    "cache/output.txt": "ignored generated output",
    "node_modules/demo/index.cjs": "module.exports='captured dependency';",
    "embedded.txt":
      "-----BEGIN PRIVATE KEY-----\nFAKE-LOCAL-KEY\n-----END PRIVATE KEY-----",
    "manual/skip.txt": "explicit exclusion wins",
    "devteleport.json": JSON.stringify({ exclude: ["manual"] }),
    "app.cjs":
      "if(require('./node_modules/demo/index.cjs')!=='captured dependency'||!require('node:fs').readFileSync('.env','utf8').includes('APP_SECRET='))process.exit(1);console.log('restored project works');",
    ".devteleport/inventory.json": "reserved local metadata",
    ".devteleport-v2-private/journal.json": "reserved private stage",
    "previous.dtp": "existing archive",
  };
  for (const [file, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), contents);
  }
  execFileSync("git", ["add", "app.cjs", ".gitignore"], { cwd: root });
  return { temp, root };
}

for (const format of [1, 2] as const) {
  test(`format ${format}: opt-in captures Git-ignored files, .env, dependencies and embedded credentials; default stays private`, async (t) => {
    const { root, temp } = await fixture(t);
    const ordinary = await capture({
      root,
      format,
      name: "default",
      output: temp,
      dryRun: true,
    });
    for (const file of [
      ".env",
      ".env.local",
      "private/config.json",
      "cache/output.txt",
      "node_modules/demo/index.cjs",
      "embedded.txt",
    ])
      assert(!ordinary.files!.some((entry) => entry.path === file), file);
    const preview = await capture({
      root,
      format,
      name: "all",
      output: temp,
      dryRun: true,
      includeIgnored: true,
    });
    for (const file of [
      ".env",
      ".env.local",
      "private/config.json",
      "cache/output.txt",
      "node_modules/demo/index.cjs",
      "embedded.txt",
    ])
      assert(
        preview.files!.some((entry) => entry.path === file),
        file,
      );
    assert(preview.warnings.some((warning) => warning.includes("credentials")));
    assert.equal(preview.capturePolicy.includeIgnored, true);
    assert(
      !JSON.stringify(preview).includes(secret),
      "Review must not reveal .env contents",
    );
    await assert.rejects(fs.stat(path.join(temp, "all.dtp")), {
      code: "ENOENT",
    });
    const archived = await capture({
      root,
      format,
      name: "all",
      output: temp,
      password,
      includeIgnored: true,
    });
    assert(
      !Buffer.from(await fs.readFile(archived.output)).includes(
        Buffer.from(secret),
      ),
      "Snapshot contents must remain encrypted",
    );
    const metadata = await snapshotMetadata(archived.output, password);
    assert(metadata.capturePolicy?.includeIgnored);
    for (const prefix of [
      ".git/config",
      ".git/hooks",
      ".devteleport",
      ".devteleport-v2-private",
      "previous.dtp",
      "manual",
    ])
      assert(
        !metadata.files.some(
          (entry) =>
            entry.path === prefix || entry.path.startsWith(prefix + "/"),
        ),
        prefix,
      );
    assert(
      (await diffSnapshotWithDirectory(archived.output, root, password))
        .identical,
      "Diff must use the capture's inclusion policy",
    );
    await fs.rm(root, { recursive: true });
    const target = path.join(temp, "restored");
    const restoreReview = await restore(archived.output, {
      target,
      password,
      dryRun: true,
    });
    assert(
      restoreReview.warnings.some((warning) => warning.includes("credentials")),
    );
    assert(!JSON.stringify(restoreReview).includes(secret));
    const restored = await restore(archived.output, { target, password });
    assert(restored.verification.ok);
    assert.equal(
      await fs.readFile(path.join(target, ".env"), "utf8"),
      "APP_SECRET=" + secret + "\n",
    );
    assert.equal(
      await fs.readFile(path.join(target, "cache/output.txt"), "utf8"),
      "ignored generated output",
    );
    assert((await verifyFromSnapshot(target, archived.output, password)).ok);
    assert.match(
      execFileSync(process.execPath, ["app.cjs"], {
        cwd: target,
        encoding: "utf8",
      }),
      /restored project works/,
    );
    await fs.appendFile(path.join(target, ".env"), "NEW_VALUE=changed\n");
    assert(
      (
        await diffSnapshotWithDirectory(archived.output, target, password)
      ).modified.some((entry) => entry.path === ".env"),
    );
  });
  test(`format ${format}: including ignored files still refuses escaping symlinks`, async (t) => {
    const { root, temp } = await fixture(t);
    await fs.symlink("../../outside", path.join(root, "private", "escape"));
    await assert.rejects(
      capture({
        root,
        format,
        name: "unsafe",
        output: temp,
        password,
        includeIgnored: true,
      }),
      /escapes workspace/,
    );
    await assert.rejects(fs.stat(path.join(temp, "unsafe.dtp")), {
      code: "ENOENT",
    });
  });
}

test("CLI --include-ignored is explicit, captures .env, and keeps preview values private", async (t) => {
  const { root, temp } = await fixture(t),
    cli = path.resolve("apps/cli/main.ts");
  const result = execFileSync(
    process.execPath,
    [
      cli,
      "capture",
      "--root",
      root,
      "--name",
      "cli",
      "--output",
      temp,
      "--include-ignored",
      "--dry-run",
    ],
    { encoding: "utf8" },
  );
  const preview = JSON.parse(result);
  assert(preview.files.some((entry) => entry.path === ".env"));
  assert(preview.capturePolicy.includeIgnored);
  assert(!result.includes(secret));
});

test("legacy metadata without capture policy is accepted, and malformed policy is rejected", async (t) => {
  const { root, temp } = await fixture(t);
  const archive = await capture({
    root,
    name: "schema",
    output: temp,
    password,
  });
  const manifest = await snapshotMetadata(archive.output, password);
  delete manifest.capturePolicy;
  assert(validateManifest(manifest));
  assert.throws(
    () =>
      validateManifest({
        ...manifest,
        capturePolicy: { includeIgnored: "yes" },
      }),
    /inclusion policy/,
  );
});
