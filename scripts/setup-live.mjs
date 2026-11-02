// Offline mixed-manager acceptance fixture. Requires installed native pnpm/npm.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { capture, restore } from "../packages/core/index.ts";
import { setupDirectory } from "../packages/core/setup.ts";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-mixed-setup-"));
const env = {
  ...process.env,
  npm_config_cache: path.join(temp, "npm-cache"),
  npm_config_update_notifier: "false",
  COREPACK_ENABLE_NETWORK: "0",
  COREPACK_ENABLE_PROJECT_SPEC: "0",
  npm_config_manage_package_manager_versions: "false",
  pnpm_config_pm_on_fail: "ignore",
};
const run = (tool, args, cwd) =>
  execFileSync(tool, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120000,
  });
try {
  const root = path.join(temp, "source"),
    dependency = path.join(temp, "dependency");
  await fs.mkdir(root);
  await fs.mkdir(dependency);
  await fs.writeFile(
    path.join(dependency, "package.json"),
    JSON.stringify({
      name: "devteleport-local-fixture",
      version: "1.0.0",
      main: "index.cjs",
    }),
  );
  await fs.writeFile(
    path.join(dependency, "index.cjs"),
    "module.exports='installed runtime';",
  );
  const packed = JSON.parse(
    run(
      "npm",
      [
        "pack",
        "--offline",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        root,
      ],
      dependency,
    ),
  );
  const tarball = packed[0].filename;
  for (const [directory, manager] of [
    ["", "pnpm"],
    ["service", "npm"],
  ]) {
    const dir = path.join(root, directory);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: directory || "frontend",
        private: true,
        version: "1.0.0",
        packageManager: manager,
        dependencies: {
          "devteleport-local-fixture":
            "file:" + (directory ? "../" : "./") + tarball,
        },
        scripts: { postinstall: "node install.cjs", dev: "node app.cjs" },
      }),
    );
    await fs.writeFile(
      path.join(dir, "install.cjs"),
      "if(process.env.DEVTELEPORT_PASSWORD)throw Error('password reached installer');require('node:fs').writeFileSync('dependencies-ready.txt','ready');console.log('offline setup completed');",
    );
    await fs.writeFile(
      path.join(dir, "app.cjs"),
      "if(require('devteleport-local-fixture')!=='installed runtime'||require('node:fs').readFileSync('dependencies-ready.txt','utf8')!=='ready')process.exit(1);console.log('project runs');",
    );
  }
  await fs.writeFile(
    path.join(root, "pnpm-workspace.yaml"),
    "minimumReleaseAgeExclude:\n  - devteleport-local-fixture\n",
  );
  await fs.writeFile(
    path.join(root, ".env"),
    "LOCAL_FIXTURE=private-fixture-only\n",
  );
  run(
    "pnpm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--store-dir",
      path.join(temp, "store"),
    ],
    root,
  );
  run(
    "npm",
    [
      "install",
      "--offline",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    path.join(root, "service"),
  );
  const password = "mixed-manager release passphrase";
  const archive = await capture({
    root,
    format: 2,
    name: "mixed",
    output: temp,
    password,
    includeIgnored: true,
    excludeGenerated: true,
  });
  await fs.rm(root, { recursive: true });
  const target = path.join(temp, "restored");
  const preview = await restore(archive.output, {
    target,
    password,
    dryRun: true,
    install: true,
    approveExecution: true,
  });
  assert.deepEqual(
    preview.dependencies.packages.map((p) => ({
      directory: p.directory,
      manager: p.manager,
      installAt: p.installAt,
    })),
    [
      { directory: ".", manager: "pnpm", installAt: "." },
      { directory: "service", manager: "npm", installAt: "service" },
    ],
  );
  assert.deepEqual(preview.dependencies.blockers, []);
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
  const result = await restore(archive.output, {
    target,
    password,
    install: true,
    approveExecution: true,
  });
  assert(result.verification.ok);
  assert.match(run("pnpm", ["run", "dev"], target), /project runs/);
  assert.match(
    run("npm", ["run", "dev"], path.join(target, "service")),
    /project runs/,
  );
  assert.equal(
    await fs.readFile(path.join(target, ".env"), "utf8"),
    "LOCAL_FIXTURE=private-fixture-only\n",
  );
  const retry = await setupDirectory(target, true, true);
  assert.equal(retry.installation.state, "installed");
  const report = {
    at: new Date().toISOString(),
    ok: true,
    sourceRemoved: true,
    settingsOnlyPnpm: true,
    independentNpm: true,
    localTarballDependencyInstalled: true,
    environmentPreserved: true,
    approvedInstalls: 2,
    frozenRetry: true,
    startupCommands: ["pnpm run dev", "npm run dev"],
    actualUserProjectModified: false,
  };
  await fs.mkdir("dist/evidence", { recursive: true });
  await fs.writeFile(
    "dist/evidence/mixed-setup.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
