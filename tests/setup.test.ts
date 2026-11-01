import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  setupDirectory,
  installDependencies,
  nodeSatisfies,
} from "../packages/core/setup.ts";
import { capture, restore } from "../packages/core/index.ts";

const password = "guided restore fixture password";
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-setup-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "source");
  await fs.mkdir(path.join(root, "cms"), { recursive: true });
  await fs.mkdir(path.join(root, ".fixture-dependency"));
  await fs.writeFile(
    path.join(root, ".fixture-dependency", "package.json"),
    JSON.stringify({
      name: "@devteleport-fixture/runtime",
      version: "1.0.0",
      main: "index.cjs",
    }),
  );
  await fs.writeFile(
    path.join(root, ".fixture-dependency", "index.cjs"),
    "module.exports='installed runtime';",
  );
  for (const [dir, name, script] of [
    ["", "frontend", "dev"],
    ["cms", "cms", "develop"],
  ]) {
    await fs.writeFile(
      path.join(root, dir, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        private: true,
        engines: { node: ">=24" },
        dependencies: {
          "@devteleport-fixture/runtime":
            "file:" + (dir ? "../" : "./") + ".fixture-dependency",
        },
        scripts: { postinstall: "node install.cjs", [script]: "node app.cjs" },
      }),
    );
    await fs.writeFile(
      path.join(root, dir, "install.cjs"),
      "const fs=require('node:fs');fs.writeFileSync('installed.txt',process.env.DEVTELEPORT_PASSWORD?'leaked':'ready');",
    );
    await fs.writeFile(
      path.join(root, dir, "app.cjs"),
      "const fs=require('node:fs');if(fs.readFileSync('installed.txt','utf8')!=='ready'||require('@devteleport-fixture/runtime')!=='installed runtime')process.exit(1);console.log('project runs');",
    );
  }
  return { temp, root };
}

test("setup finds independent frontend/CMS packages, handles absent lockfiles and reveals environment names only", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "cms", ".env.example"),
    "DATABASE_URL=never-show-this-value\nAPP_KEY=another-private-example\n",
  );
  const plan = await setupDirectory(root);
  assert.deepEqual(
    plan.packages.map((p) => p.directory),
    [".", "cms"],
  );
  assert(plan.packages.every((p) => p.command[1] === "install"));
  assert(plan.packages.every((p) => p.installAt === p.directory));
  assert.deepEqual(
    plan.packages[1].scripts.map((s) => s.name),
    ["develop"],
  );
  assert.deepEqual(plan.packages[1].environmentKeys, [
    "APP_KEY",
    "DATABASE_URL",
  ]);
  assert(!JSON.stringify(plan).includes("never-show-this-value"));
  await assert.rejects(fs.stat(path.join(root, "installed.txt")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.stat(path.join(root, "package-lock.json")), {
    code: "ENOENT",
  });
});

test("workspace packages share the declared root install while unrelated CMS stays independent", async (t) => {
  const { root } = await fixture(t);
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  manifest.workspaces = ["packages/*"];
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
  await fs.mkdir(path.join(root, "packages", "ui"), { recursive: true });
  await fs.writeFile(
    path.join(root, "packages", "ui", "package.json"),
    '{"name":"ui"}',
  );
  const plan = await setupDirectory(root);
  assert.equal(
    plan.packages.find((p) => p.directory === "packages/ui")!.installAt,
    ".",
  );
  assert.equal(
    plan.packages.find((p) => p.directory === "cms")!.installAt,
    "cms",
  );
});

test("pnpm workspace planning uses frozen locks and does not switch a nested npm project", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "package.json"),
    '{"name":"frontend","packageManager":"pnpm@10.0.0","scripts":{"dev":"vite"}}',
  );
  await fs.writeFile(
    path.join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n",
  );
  await fs.writeFile(
    path.join(root, "pnpm-workspace.yaml"),
    "packages:\n  - 'packages/*'\n",
  );
  const plan = await setupDirectory(root);
  assert.deepEqual(plan.packages[0].command, [
    "pnpm",
    "install",
    "--frozen-lockfile",
  ]);
  assert.equal(plan.packages[1].manager, "npm");
});

test("Node engine checks refuse mismatches and leave unknown ranges for manual review", () => {
  for (const range of [
    ">=20 <25",
    "^24.0.0",
    "~24.21.0",
    "24.x",
    "20 || >=24",
    ">= 24",
  ])
    assert.equal(nodeSatisfies("v24.21.0", range), true, range);
  for (const range of ["<24", "^22", ">24", "<=23", "~24.20.0"])
    assert.equal(nodeSatisfies("24.21.0", range), false, range);
  assert.equal(nodeSatisfies("24.21.0", "lts/jod"), null);
});

for (const format of [1, 2] as const)
  test(`format ${format} previews before restore and automatically installs both packages only with approval`, async (t) => {
    const { root, temp } = await fixture(t);
    const archive = await capture({
      root,
      output: temp,
      name: "guided",
      password,
      format,
    });
    await fs.rm(root, { recursive: true });
    const target = path.join(temp, "restored");
    const plan = await restore(archive.output, {
      target,
      password,
      install: true,
      dryRun: true,
    });
    assert.equal(plan.dependencies.packages.length, 2);
    assert(plan.dependencies.packages.every((p) => p.command[1] === "install"));
    await assert.rejects(fs.stat(target), { code: "ENOENT" });
    await assert.rejects(
      restore(archive.output, { target, password, install: true }),
      /approve-execution/,
    );
    await assert.rejects(fs.stat(target), { code: "ENOENT" });
    const saved = process.env.DEVTELEPORT_PASSWORD;
    process.env.DEVTELEPORT_PASSWORD =
      "do-not-pass-snapshot-passphrase-to-project";
    try {
      const result = await restore(archive.output, {
        target,
        password,
        install: true,
        approveExecution: true,
      });
      assert(result.verification.ok);
      assert.equal(
        result.postActions.filter((a) => a.includes("completed")).length,
        2,
      );
    } finally {
      if (saved === undefined) delete process.env.DEVTELEPORT_PASSWORD;
      else process.env.DEVTELEPORT_PASSWORD = saved;
    }
    for (const dir of ["", "cms"]) {
      assert.equal(
        await fs.readFile(path.join(target, dir, "installed.txt"), "utf8"),
        "ready",
      );
      assert(
        (await fs.stat(path.join(target, dir, "package-lock.json"))).isFile(),
      );
      assert.match(
        execFileSync("npm", ["run", dir ? "develop" : "dev"], {
          cwd: path.join(target, dir),
          encoding: "utf8",
        }),
        /project runs/,
      );
    }
    const retry = await setupDirectory(target);
    assert(retry.packages.every((p) => p.command[1] === "ci"));
    assert.equal(
      (await setupDirectory(target, true, true)).installation?.completed.length,
      2,
    );
  });

test("changed manifests and symbolic-link lockfiles are refused before executing any project script", async (t) => {
  const { root, temp } = await fixture(t);
  const plan = await setupDirectory(root);
  await fs.appendFile(path.join(root, "cms", "package.json"), " ");
  await assert.rejects(installDependencies(root, plan, true), /changed/);
  await assert.rejects(fs.stat(path.join(root, "installed.txt")), {
    code: "ENOENT",
  });
  const current = await setupDirectory(root);
  const content = await fs.readFile(path.join(root, "cms", "package.json"));
  await fs.writeFile(path.join(temp, "outside.json"), content);
  await fs.unlink(path.join(root, "cms", "package.json"));
  await fs.symlink(
    path.join(temp, "outside.json"),
    path.join(root, "cms", "package.json"),
  );
  await assert.rejects(
    installDependencies(root, current, true),
    /symbolic-link/,
  );
});

test("unsupported package manager blocks automatic execution before restore but permits files-only recovery", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(
    path.join(root, "cms", "package.json"),
    '{"name":"cms","packageManager":"yarn@4.0.0"}',
  );
  const archive = await capture({
    root,
    output: temp,
    name: "manual",
    password,
    format: 2,
  });
  const target = path.join(temp, "blocked");
  await assert.rejects(
    restore(archive.output, {
      target,
      password,
      install: true,
      approveExecution: true,
    }),
    /not supported/,
  );
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
  assert((await restore(archive.output, { target, password })).verification.ok);
  await assert.rejects(fs.stat(path.join(target, "installed.txt")), {
    code: "ENOENT",
  });
});

test("failed nested install preserves restored files and earlier successful installs without exposing script output", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(
    path.join(root, "cms", "install.cjs"),
    "console.error('private-fixture-value');process.exit(7);",
  );
  const archive = await capture({
    root,
    output: temp,
    name: "failure",
    password,
    format: 2,
  });
  const target = path.join(temp, "partial");
  await assert.rejects(
    restore(archive.output, {
      target,
      password,
      install: true,
      approveExecution: true,
    }),
    (error: Error) => {
      assert.match(error.message, /failed in cms/);
      assert.match(error.message, /earlier successful installs remain/);
      assert(!error.message.includes("private-fixture-value"));
      return true;
    },
  );
  assert.equal(
    await fs.readFile(path.join(target, "installed.txt"), "utf8"),
    "ready",
  );
  assert((await fs.stat(path.join(target, "cms", "package.json"))).isFile());
  assert.equal(
    JSON.parse(
      await fs.readFile(
        path.join(target, ".devteleport", "journal.json"),
        "utf8",
      ),
    ).status,
    "files-restored",
  );
});
