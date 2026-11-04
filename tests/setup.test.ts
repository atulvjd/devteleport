import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  setupDirectory,
  installDependencies,
  nodeSatisfies,
  reviewDependencies,
  type InstallationReport,
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

test("settings-only and empty pnpm workspace lists retain root and independent package installs", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "frontend",
      packageManager: "pnpm",
      workspaces: ["cms"],
      scripts: { dev: "node app.cjs" },
    }),
  );
  await fs.writeFile(
    path.join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n",
  );
  for (const yaml of [
    "",
    "# settings only\n",
    "minimumReleaseAgeExclude:\n  - fixture-local-package\n",
    "packages: []\n",
    "packages: [] # root only\n",
  ]) {
    await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), yaml);
    const plan = await setupDirectory(root);
    assert.equal(plan.packages.length, 2);
    assert.equal(plan.packages[0].manager, "pnpm");
    assert.equal(plan.packages[1].manager, "npm");
    assert.equal(
      plan.packages[1].installAt,
      "cms",
      "pnpm file overrides package.json workspace ownership",
    );
    assert(!plan.blockers.length, JSON.stringify(plan.blockers));
  }
  for (const format of [1, 2] as const) {
    const archive = await capture({
      root,
      output: temp,
      name: "settings-only-" + format,
      password,
      format,
    });
    const target = path.join(temp, "settings-restored-" + format);
    const review = await restore(archive.output, {
      target,
      password,
      dryRun: true,
      install: true,
      approveExecution: true,
    });
    assert.equal(review.dependencies.packages.length, 2);
    assert(!review.dependencies.blockers.length);
    await assert.rejects(fs.stat(target), { code: "ENOENT" });
  }
});

test("missing pnpm blocks approved installation before any restore destination or project script is created", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "frontend",
      packageManager: "pnpm",
      scripts: { postinstall: "node install.cjs" },
    }),
  );
  const originalAccess = fs.access;
  t.mock.method(fs, "access", async (file, ...args) => {
    if (path.basename(String(file)) === "pnpm")
      throw Object.assign(new Error("fixture pnpm is unavailable"), {
        code: "ENOENT",
      });
    return originalAccess(file, ...args);
  });
  const plan = await setupDirectory(root);
  assert.equal(plan.packages[0].manager, "pnpm");
  assert.equal(plan.tools.find((tool) => tool.name === "pnpm")?.file, null);
  assert(
    plan.blockers.some((blocker) =>
      blocker.includes("working native pnpm tool"),
    ),
  );
  await assert.rejects(
    installDependencies(root, plan, true),
    /working native pnpm tool/,
  );
  await assert.rejects(fs.stat(path.join(root, "installed.txt")), {
    code: "ENOENT",
  });
  const archive = await capture({
    root,
    output: temp,
    name: "missing-tool",
    password,
    format: 2,
  });
  const target = path.join(temp, "refused-restore");
  const preview = await restore(archive.output, {
    target,
    password,
    dryRun: true,
    install: true,
    approveExecution: true,
  });
  assert(
    preview.dependencies.blockers.some((blocker) =>
      blocker.includes("working native pnpm tool"),
    ),
  );
  await assert.rejects(
    restore(archive.output, {
      target,
      password,
      install: true,
      approveExecution: true,
    }),
    /working native pnpm tool/,
  );
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
});

test("unsupported pnpm YAML remains blocked and known review failures explain the affected file", async (t) => {
  const { root } = await fixture(t);
  for (const yaml of [
    "packages: [apps/*]\n",
    "packages:\n",
    "defaults: &scope\n  packages: ['*']\n<<: *scope\n",
    "'packages': ['*']\n",
    "packages: []\n'useNodeVersion': '24.0.0'\n",
    "packages: []\nsettings: &runtime\n  useNodeVersion: '24.0.0'\n<<: *runtime\n",
  ]) {
    await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), yaml);
    await assert.rejects(setupDirectory(root), /pnpm-workspace.yaml/);
  }
  await fs.writeFile(
    path.join(root, "pnpm-workspace.yaml"),
    "minimumReleaseAge: 60\nuseNodeVersion: '24.0.0'\n",
  );
  assert(
    (await setupDirectory(root)).blockers.some((b) =>
      b.includes("managed runtime"),
    ),
  );
});

test("failed dependency review never exposes parser file bodies as diagnostics", async () => {
  const secret = "private-parser-fixture-value";
  const body = Buffer.from('{"name":"fixture", BROKEN_' + secret + "}");
  const crypto = await import("node:crypto");
  const entry = {
    path: "package.json",
    type: "file" as const,
    mode: 0o600,
    size: body.length,
    checksum: crypto.createHash("sha256").update(body).digest("hex"),
    data: "",
  };
  const plan = await reviewDependencies([entry], async () => body);
  assert.equal(plan.packages.length, 0);
  assert(
    plan.blockers.some((b) => b.includes("Invalid package.json: package.json")),
  );
  assert(!JSON.stringify(plan).includes(secret));
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

test("runtime mismatches and conflicting lockfiles are actionable preflight blockers", async (t) => {
  const { root } = await fixture(t);
  const file = path.join(root, "cms", "package.json"),
    pkg = JSON.parse(await fs.readFile(file, "utf8"));
  pkg.engines.node = "<10";
  await fs.writeFile(file, JSON.stringify(pkg));
  await fs.writeFile(path.join(root, "yarn.lock"), "");
  await fs.writeFile(path.join(root, "package-lock.json"), "{}");
  const plan = await setupDirectory(root);
  assert(plan.blockers.some((b) => b.includes("Conflicting")));
  assert(plan.blockers.some((b) => b.includes("does not match")));
  await assert.rejects(installDependencies(root, plan, true), /preflight/);
  await assert.rejects(fs.stat(path.join(root, "installed.txt")), {
    code: "ENOENT",
  });
});

test("a root lifecycle change to CMS metadata stops execution before the unreviewed CMS install", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "install.cjs"),
    "const fs=require('node:fs');fs.writeFileSync('installed.txt','ready');fs.appendFileSync('cms/package.json',' ');",
  );
  const plan = await setupDirectory(root);
  await assert.rejects(installDependencies(root, plan, true), /inputs changed/);
  assert.equal(
    await fs.readFile(path.join(root, "installed.txt"), "utf8"),
    "ready",
  );
  await assert.rejects(fs.stat(path.join(root, "cms", "installed.txt")), {
    code: "ENOENT",
  });
});

test("cancelling guided installation terminates lifecycle descendants and preserves the project", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "install.cjs"),
    "const fs=require('node:fs');const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('child.pid',String(child.pid));setInterval(()=>{},1000);",
  );
  const child = spawn(
    process.execPath,
    ["apps/cli/main.ts", "setup", root, "--install", "--approve-execution"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const exited = once(child, "exit");
  child.stderr.resume();
  t.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exited;
  });
  let pid = 0;
  for (let attempt = 0; attempt < 500 && !pid; attempt++) {
    try {
      pid = Number(await fs.readFile(path.join(root, "child.pid"), "utf8"));
    } catch {}
    if (!pid) await new Promise((r) => setTimeout(r, 20));
  }
  assert(pid > 0, "Lifecycle descendant did not start");
  child.kill("SIGTERM");
  await exited;
  let alive = true;
  for (let attempt = 0; attempt < 100 && alive; attempt++) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 20));
    } catch (error) {
      if (error.code === "ESRCH") alive = false;
      else throw error;
    }
  }
  assert.equal(alive, false, "A lifecycle descendant survived cancellation");
  assert((await fs.stat(path.join(root, "cms", "package.json"))).isFile());
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
  const reports: InstallationReport[] = [];
  await assert.rejects(
    restore(archive.output, {
      target,
      password,
      install: true,
      approveExecution: true,
      onInstallState: (report) => reports.push(report),
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
  const failed = reports.at(-1)!;
  assert.equal(failed.state, "failed");
  assert.deepEqual(
    failed.packages.map((pkg) => [pkg.directory, pkg.state]),
    [
      [".", "installed"],
      ["cms", "failed"],
    ],
  );
  assert(!JSON.stringify(reports).includes("private-fixture-value"));
  assert(!JSON.stringify(reports).includes(password));
  assert.equal(
    reports[0].packages[0].state,
    "pending",
    "Report snapshots must not mutate after emission",
  );

  // Recover the existing destination in place. A successful root package must
  // not run again when the user selects only the failed independent package.
  await fs.writeFile(path.join(target, "installed.txt"), "keep-root-install");
  await fs.writeFile(
    path.join(target, "cms", "install.cjs"),
    "require('node:fs').writeFileSync('installed.txt','retried');",
  );
  const review = await setupDirectory(target);
  const retried = await setupDirectory(
    target,
    true,
    true,
    undefined,
    undefined,
    {
      expectedPlanId: review.id,
      installDirectories: ["cms"],
      onInstallState: (report) => reports.push(report),
    },
  );
  assert.deepEqual(
    retried.installation?.completed.map((pkg) => pkg.directory),
    ["cms"],
  );
  assert.deepEqual(
    reports.at(-1)!.packages.map((pkg) => [pkg.directory, pkg.state]),
    [
      [".", "not-selected"],
      ["cms", "installed"],
    ],
  );
  assert.equal(
    await fs.readFile(path.join(target, "installed.txt"), "utf8"),
    "keep-root-install",
  );
  assert.equal(
    await fs.readFile(path.join(target, "cms", "installed.txt"), "utf8"),
    "retried",
  );
});

test("setup retry requires current review, explicit approval and a valid independent package selection", async (t) => {
  const { root } = await fixture(t);
  const review = await setupDirectory(root);
  for (const installDirectories of [
    [],
    ["missing"],
    ["cms", "cms"],
    ["../escape"],
  ]) {
    await assert.rejects(
      setupDirectory(root, true, true, undefined, undefined, {
        expectedPlanId: review.id,
        installDirectories,
      }),
      /installation folders/,
    );
  }
  await assert.rejects(
    setupDirectory(root, true, false, undefined, undefined, {
      expectedPlanId: review.id,
      installDirectories: ["cms"],
    }),
    /explicit execution approval/,
  );
  await fs.appendFile(path.join(root, "cms", "package.json"), " ");
  await assert.rejects(
    setupDirectory(root, true, true, undefined, undefined, {
      expectedPlanId: review.id,
      installDirectories: ["cms"],
    }),
    /review changed/,
  );
  await assert.rejects(fs.stat(path.join(root, "installed.txt")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.stat(path.join(root, "cms", "installed.txt")), {
    code: "ENOENT",
  });
});

test("format 1 restore publishes per-package status and marks later installs not run", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "install.cjs"), "process.exit(7);");
  const archive = await capture({
    root,
    output: temp,
    name: "failure-v1",
    password,
    format: 1,
  });
  const reports: InstallationReport[] = [];
  const target = path.join(temp, "partial-v1");
  await assert.rejects(
    restore(archive.output, {
      target,
      password,
      install: true,
      approveExecution: true,
      onInstallState: (report) => reports.push(report),
    }),
    /failed in \./,
  );
  assert.deepEqual(
    reports.at(-1)!.packages.map((pkg) => [pkg.directory, pkg.state]),
    [
      [".", "failed"],
      ["cms", "not-run"],
    ],
  );
  assert((await fs.stat(path.join(target, "package.json"))).isFile());
});

test("CLI setup accepts a reviewed selective retry and emits safe structured package states", async (t) => {
  const { root } = await fixture(t);
  const review = await setupDirectory(root);
  const command = spawnSync(
    process.execPath,
    [
      "apps/cli/main.ts",
      "setup",
      root,
      "--install",
      "--approve-execution",
      "--plan-id",
      review.id,
      "--install-at",
      "cms",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DEVTELEPORT_PROGRESS: "1",
        DEVTELEPORT_PASSWORD: password,
      },
    },
  );
  assert.equal(command.status, 0, command.stderr);
  const result = JSON.parse(command.stdout);
  assert.deepEqual(
    result.installation.completed.map((pkg) => pkg.directory),
    ["cms"],
  );
  const reports = command.stderr
    .split("\n")
    .filter((line) => line.startsWith("DTP_PROGRESS:"))
    .map((line) => JSON.parse(line.slice(13)))
    .filter((event) => event.kind === "installation");
  assert.equal(reports.at(-1).report.state, "installed");
  assert.deepEqual(
    reports.at(-1).report.packages.map((pkg) => [pkg.directory, pkg.state]),
    [
      [".", "not-selected"],
      ["cms", "installed"],
    ],
  );
  assert(!JSON.stringify(reports).includes(password));
  await assert.rejects(fs.stat(path.join(root, "installed.txt")), {
    code: "ENOENT",
  });
  assert.equal(
    await fs.readFile(path.join(root, "cms", "installed.txt"), "utf8"),
    "ready",
  );
});
