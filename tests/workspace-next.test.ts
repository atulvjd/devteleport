import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  capture,
  restore,
  verifyFromSnapshot,
  history,
} from "../packages/core/index.ts";
import { snapshotMetadata } from "../packages/core/stream-v2.ts";
import { scanEnvironment } from "../packages/core/environment.ts";
import { diffSnapshotWithDirectory } from "../packages/core/diff.ts";
import { runProject } from "../packages/core/startup.ts";

const password = "disposable long passphrase";
async function fixture(run: (root: string, source: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-next-"));
  try {
    const source = path.join(root, "source");
    await fs.mkdir(source);
    await run(root, source);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
test("incremental archives reuse unchanged content and restore independently of the source", async () =>
  fixture(async (root, source) => {
    await fs.writeFile(
      path.join(source, "large.bin"),
      Buffer.alloc(1024 * 1024, 7),
    );
    await fs.writeFile(path.join(source, "change.txt"), "before");
    await fs.writeFile(path.join(source, "remove.txt"), "gone");
    await capture({
      root: source,
      format: 2,
      name: "base",
      output: root,
      password,
    });
    const base = path.join(root, "base.dtp");
    await fs.writeFile(path.join(source, "change.txt"), "after");
    await fs.unlink(path.join(source, "remove.txt"));
    await fs.writeFile(path.join(source, "added.txt"), "new");
    const result = await capture({
      root: source,
      format: 2,
      name: "delta",
      output: root,
      password,
      base,
    });
    assert.equal(result.formatVersion, 3);
    const delta = path.join(root, "delta.dtp");
    assert((await fs.stat(delta)).size < (await fs.stat(base)).size / 10);
    await assert.rejects(
      snapshotMetadata(delta, password),
      /requires its full base/,
    );
    await assert.rejects(
      snapshotMetadata(delta, password, delta),
      /Wrong incremental base/,
    );
    const m = await snapshotMetadata(delta, password, base);
    assert(m.files.find((file) => file.path === "large.bin")?.inherited);
    assert(
      !(await diffSnapshotWithDirectory(delta, source, password, { base }))
        .summary.modified,
    );
    await fs.rm(source, { recursive: true });
    const target = path.join(root, "restored");
    const review = await restore(delta, {
      target,
      password,
      base,
      dryRun: true,
    });
    assert(review.readiness.ready);
    await restore(delta, { target, password, base });
    assert.equal(
      await fs.readFile(path.join(target, "change.txt"), "utf8"),
      "after",
    );
    assert.equal(
      (await fs.stat(path.join(target, "large.bin"))).size,
      1024 * 1024,
    );
    await assert.rejects(fs.stat(path.join(target, "remove.txt")));
    assert((await verifyFromSnapshot(target, delta, password, base)).ok);
    assert(
      (await history(root)).every((item) => !item.status.includes("unknown")),
    );
    await assert.rejects(
      capture({
        root: target,
        format: 2,
        name: "chain",
        output: root,
        password,
        base: delta,
      }),
      /requires its full base|full format 2/,
    );
  }));
test("environment opt-in selects files and reveals names without values", async () =>
  fixture(async (root, source) => {
    await fs.writeFile(
      path.join(source, ".env"),
      "PRIVATE_KEY=secret-value-never-display\nPORT=3000\n",
    );
    await fs.writeFile(path.join(source, ".env.local"), "OTHER=hidden-other\n");
    await fs.writeFile(
      path.join(source, ".env.example"),
      "PRIVATE_KEY=\nREQUIRED_NEXT=\n",
    );
    await fs.symlink(
      path.join(root, "outside.env"),
      path.join(source, ".env.link"),
    );
    const scan = await scanEnvironment(source);
    assert(!JSON.stringify(scan).includes("secret-value"));
    assert(!scan.files.some((file) => file.path === ".env.link"));
    await fs.unlink(path.join(source, ".env.link"));
    for (const format of [1, 2] as const) {
      const envFiles = [".env", ".env.example"];
      await capture({
        root: source,
        format,
        name: "env" + format,
        output: root,
        password,
        envFiles,
      });
      const archive = path.join(root, "env" + format + ".dtp");
      const m = await snapshotMetadata(archive, password);
      assert(m.files.some((file) => file.path === ".env"));
      assert(!m.files.some((file) => file.path === ".env.local"));
      const review = await restore(archive, {
        password,
        target: path.join(root, "dest" + format),
        dryRun: true,
      });
      assert(!JSON.stringify(review).includes("secret-value"));
      assert(
        review.readiness.environment.some((env) =>
          env.missing.includes("REQUIRED_NEXT"),
        ),
      );
    }
  }));
test("startup review binds the command to reviewed manifests and filters environment values", async () =>
  fixture(async (root, source) => {
    await fs.writeFile(
      path.join(source, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { dev: "node server.cjs" } }),
    );
    await fs.writeFile(path.join(source, ".env"), "SPECIAL=concealed-value\n");
    await fs.writeFile(
      path.join(source, "server.cjs"),
      "console.log('http://localhost:3210/');console.log('concealed-value');",
    );
    const review = await runProject(source, { dryRun: true });
    assert("commands" in review && review.commands.length);
    await assert.rejects(
      runProject(source, {
        script: "dev",
        packageDirectory: ".",
        planId: review.id,
      }),
      /approve/,
    );
    const logs: string[] = [];
    await runProject(source, {
      script: "dev",
      packageDirectory: ".",
      planId: review.id,
      approveExecution: true,
      onLog: (event) => logs.push(event.text),
    });
    assert(logs.some((line) => line.includes("http://localhost:3210/")));
    assert(!logs.join("\n").includes("concealed-value"));
    await fs.writeFile(
      path.join(source, "package.json"),
      JSON.stringify({ scripts: { dev: "node changed.cjs" } }),
    );
    await assert.rejects(
      runProject(source, {
        script: "dev",
        packageDirectory: ".",
        planId: review.id,
        approveExecution: true,
      }),
      /Review startup commands again/,
    );
  }));

test("readiness reports runtime mismatches, missing mappings, blank configuration and storage deficits", async () =>
  fixture(async (root, source) => {
    const { restoreReadiness } = await import("../packages/core/readiness.ts");
    const report = await restoreReadiness({
      target: path.join(root, "missing-parent", "project"),
      bytes: Number.MAX_SAFE_INTEGER,
      install: true,
      restoreDb: true,
      databases: ["app"],
      tools: [{ tool: "pg_restore", available: false }],
      dependencies: {
        id: "test",
        inputs: [],
        tools: [{ name: "python3", file: "/python", version: "3.10.0" }],
        blockers: [],
        warnings: [],
        packages: [
          {
            directory: ".",
            name: "Python fixture",
            framework: "Python",
            manager: "python3",
            requiredNode: null,
            requiredPython: ">=3.12,<3.14",
            requiredManager: null,
            nodeCompatible: null,
            dependencies: [],
            installAt: ".",
            command: [],
            scripts: [],
            environmentKeys: [],
            blockers: [],
            warnings: [],
          },
        ],
      },
      environment: [],
    });
    assert(!report.ready);
    assert(
      report.checks.some(
        (check) => check.name.includes("Python") && check.state === "blocked",
      ),
    );
    assert(
      report.checks.some(
        (check) => check.name.includes("mapping") && check.state === "blocked",
      ),
    );
    assert.equal(report.storage.target.sufficient, false);
    assert.equal(report.storage.staging.sufficient, false);
    assert(report.storage.target.required > report.storage.target.available);
    assert(
      report.checks
        .filter((check) => check.state === "blocked")
        .every((check) => check.fix),
    );
    await fs.writeFile(path.join(source, ".env"), "EMPTY=\nNEXT=value\n");
    await capture({
      root: source,
      format: 2,
      name: "empty-env",
      output: root,
      password,
      envFiles: [".env"],
    });
    const review = await restore(path.join(root, "empty-env.dtp"), {
      password,
      target: path.join(root, "new"),
      dryRun: true,
    });
    assert(review.readiness.environment[0].missing.includes("EMPTY"));
    assert(!review.readiness.environment[0].missing.includes("NEXT"));
  }));

test("omitted environment files leave names-only setup hints in full snapshots", async () =>
  fixture(async (root, source) => {
    await fs.writeFile(
      path.join(source, ".env"),
      "DTP_EXPECTED_VALUE=do-not-show-this-value\n",
    );
    await fs.writeFile(path.join(source, "hello.txt"), "hello");
    for (const format of [1, 2] as const) {
      await capture({
        root: source,
        format,
        name: "names" + format,
        output: root,
        password,
      });
      const review = await restore(path.join(root, "names" + format + ".dtp"), {
        password,
        target: path.join(root, "target" + format),
        dryRun: true,
      });
      assert(
        review.readiness.environment.some((env) =>
          env.missing.includes("DTP_EXPECTED_VALUE"),
        ),
      );
      assert(!JSON.stringify(review).includes("do-not-show-this-value"));
      assert(!review.files.some((file) => file.path === ".env"));
    }
  }));
