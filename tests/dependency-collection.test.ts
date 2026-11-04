import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { setupDirectory } from "../packages/core/setup.ts";

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-collection-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "project");
  await fs.mkdir(path.join(root, ".fixture-packages"), { recursive: true });
  const previousCache = process.env.npm_config_cache;
  const previousOffline = process.env.npm_config_offline;
  process.env.npm_config_cache = path.join(root, ".fixture-cache");
  process.env.npm_config_offline = "true";
  t.after(() => {
    if (previousCache === undefined) delete process.env.npm_config_cache;
    else process.env.npm_config_cache = previousCache;
    if (previousOffline === undefined) delete process.env.npm_config_offline;
    else process.env.npm_config_offline = previousOffline;
  });
  return { root, temp };
}

async function packageTarball(root, name, dependencies = {}) {
  const folder = path.join(root, ".fixture-packages", name);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: "@devteleport-collection/" + name,
      version: "1.0.0",
      main: "index.cjs",
      dependencies,
    }),
  );
  await fs.writeFile(
    path.join(folder, "index.cjs"),
    "module.exports=" + JSON.stringify(name) + ";\n",
  );
  const result = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--json",
        "--offline",
        "--ignore-scripts",
        "--pack-destination",
        "..",
      ],
      {
        cwd: folder,
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_cache: path.join(root, ".fixture-cache"),
        },
      },
    ),
  );
  return "file:" + path.join(root, ".fixture-packages", result[0].filename);
}

test("collection inventories runtime, development, optional and peer declarations without exposing dependency URLs", async (t) => {
  const { root } = await fixture(t);
  const secret = "dependency-url-credential-fixture";
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "collection-app",
      dependencies: {
        shared: "^1.0.0",
        runtime: "https://user:" + secret + "@example.invalid/runtime.tgz",
      },
      devDependencies: { shared: "^1.0.0", compiler: "^2.0.0" },
      optionalDependencies: { native: "^3.0.0" },
      peerDependencies: { react: "^19.0.0", optionalPeer: "^1.0.0" },
      peerDependenciesMeta: { optionalPeer: { optional: true } },
    }),
  );
  const plan = await setupDirectory(root);
  assert.equal(plan.packages.length, 1);
  const pkg = plan.packages[0];
  assert.equal(pkg.ecosystem, "Node.js");
  assert.deepEqual(pkg.dependencyGroups, {
    runtime: ["runtime", "shared"],
    development: ["compiler", "shared"],
    optional: ["native"],
    peer: ["optionalPeer", "react"],
  });
  assert.deepEqual(pkg.dependencies, [
    "compiler",
    "native",
    "optionalPeer",
    "react",
    "runtime",
    "shared",
  ]);
  assert(!JSON.stringify(plan).includes(secret));
  assert(!JSON.stringify(plan).includes("example.invalid"));
  assert.equal(pkg.framework, "React");
  await assert.rejects(fs.stat(path.join(root, "node_modules")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.stat(path.join(root, "package-lock.json")), {
    code: "ENOENT",
  });
});

test("approved npm setup installs direct, development, optional, peer and transitive libraries despite inherited production omissions", async (t) => {
  const { root } = await fixture(t);
  const transitive = await packageTarball(root, "transitive");
  const runtime = await packageTarball(root, "runtime", {
    "@devteleport-collection/transitive": transitive,
  });
  const development = await packageTarball(root, "development");
  const optional = await packageTarball(root, "optional");
  const peer = await packageTarball(root, "peer");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "collection-app",
      version: "1.0.0",
      private: true,
      dependencies: { "@devteleport-collection/runtime": runtime },
      devDependencies: { "@devteleport-collection/development": development },
      optionalDependencies: { "@devteleport-collection/optional": optional },
      peerDependencies: { "@devteleport-collection/peer": peer },
    }),
  );
  const overrides = {
    NODE_ENV: "production",
    npm_config_omit: "dev\noptional\npeer",
    npm_config_production: "true",
    npm_config_optional: "false",
    npm_config_offline: "true",
    npm_config_cache: path.join(root, ".fixture-cache"),
  };
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, overrides);
  try {
    for (const expectedCommand of ["install", "ci"]) {
      const preview = await setupDirectory(root);
      assert.deepEqual(preview.blockers, []);
      assert.equal(preview.packages[0].command[1], expectedCommand);
      for (const include of [
        "--include=dev",
        "--include=optional",
        "--include=peer",
      ])
        assert(preview.packages[0].command.includes(include));
      const result = await setupDirectory(
        root,
        true,
        true,
        undefined,
        undefined,
        { expectedPlanId: preview.id },
      );
      assert.equal(result.installation?.completed.length, 1);
      // Use a fresh process so the second (ci) check cannot reuse require's
      // module cache from the first installation after node_modules removal.
      const installed = JSON.parse(
        execFileSync(
          process.execPath,
          [
            "-e",
            [
              "const {createRequire}=require('node:module');",
              "const names=['runtime','development','optional','peer'];",
              "const result=Object.fromEntries(names.map(name=>[name,require('@devteleport-collection/'+name)]));",
              "result.transitive=createRequire(require.resolve('@devteleport-collection/runtime'))('@devteleport-collection/transitive');",
              "console.log(JSON.stringify(result));",
            ].join("\n"),
          ],
          { cwd: root, encoding: "utf8" },
        ),
      );
      assert.deepEqual(installed, {
        runtime: "runtime",
        development: "development",
        optional: "optional",
        peer: "peer",
        transitive: "transitive",
      });
      assert.equal(
        process.env.NODE_ENV,
        "production",
        "Installer must not mutate its parent environment",
      );
      await fs.rm(path.join(root, "node_modules"), { recursive: true });
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("collection installs workspace libraries once at their root and independent nested libraries in their own folder", async (t) => {
  const { root } = await fixture(t);
  const shared = await packageTarball(root, "shared");
  const api = await packageTarball(root, "api-library");
  await fs.mkdir(path.join(root, "packages", "ui"), { recursive: true });
  await fs.mkdir(path.join(root, "api"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "workspace-root",
      private: true,
      workspaces: ["packages/*"],
    }),
  );
  await fs.writeFile(
    path.join(root, "packages/ui/package.json"),
    JSON.stringify({
      name: "@devteleport-collection/ui",
      version: "1.0.0",
      devDependencies: { "@devteleport-collection/shared": shared },
    }),
  );
  await fs.writeFile(
    path.join(root, "api/package.json"),
    JSON.stringify({
      name: "collection-api",
      private: true,
      dependencies: { "@devteleport-collection/api-library": api },
    }),
  );
  const preview = await setupDirectory(root);
  assert.equal(
    preview.packages.find((pkg) => pkg.directory === "packages/ui")?.installAt,
    ".",
  );
  assert.equal(
    preview.packages.find((pkg) => pkg.directory === "api")?.installAt,
    "api",
  );
  const result = await setupDirectory(root, true, true);
  assert.deepEqual(
    result.installation?.completed.map((pkg) => pkg.directory),
    [".", "api"],
  );
  const workspaceRequire = createRequire(
    path.join(root, "packages/ui/package.json"),
  );
  const apiRequire = createRequire(path.join(root, "api/package.json"));
  assert.equal(workspaceRequire("@devteleport-collection/shared"), "shared");
  assert.equal(
    apiRequire("@devteleport-collection/api-library"),
    "api-library",
  );
});

test("collection plans Yarn and Bun installs with their own lockfile policy", async (t) => {
  const { root } = await fixture(t);
  for (const [manager, lockfile] of [
    ["yarn", "yarn.lock"],
    ["bun", "bun.lock"],
  ]) {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "collection-manager",
        private: true,
        packageManager: manager,
        dependencies: { "collection-library": "^1.0.0" },
      }),
    );
    const unlocked = await setupDirectory(root);
    assert.equal(unlocked.packages[0].manager, manager);
    assert.equal(unlocked.packages[0].command[0], manager);
    assert(
      !unlocked.packages[0].command.some((arg) =>
        ["--immutable", "--frozen-lockfile"].includes(arg),
      ),
    );
    await fs.writeFile(
      path.join(root, lockfile),
      manager === "yarn" ? "# yarn lockfile v1\n" : "{}\n",
    );
    const locked = await setupDirectory(root);
    assert.equal(locked.packages[0].manager, manager);
    assert(
      locked.packages[0].command.some((arg) =>
        ["--immutable", "--frozen-lockfile"].includes(arg),
      ),
    );
    const available = locked.tools.find(
      (tool) => tool.name === manager,
    )?.version;
    if (!available)
      assert(
        locked.blockers.some((blocker) => blocker.includes(manager)),
        "Unavailable tools must remain explicit blockers",
      );
    await fs.unlink(path.join(root, lockfile));
  }
});

test("approved pnpm setup includes runtime, development and optional libraries despite production configuration", async (t) => {
  if (spawnSync("pnpm", ["--version"], { encoding: "utf8" }).status !== 0)
    return t.skip(
      "A native pnpm executable is required for this installation acceptance test.",
    );
  const { root } = await fixture(t);
  const runtime = await packageTarball(root, "pnpm-runtime");
  const development = await packageTarball(root, "pnpm-development");
  const optional = await packageTarball(root, "pnpm-optional");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "collection-pnpm",
      version: "1.0.0",
      private: true,
      packageManager: "pnpm",
      dependencies: { "@devteleport-collection/pnpm-runtime": runtime },
      devDependencies: {
        "@devteleport-collection/pnpm-development": development,
      },
      optionalDependencies: {
        "@devteleport-collection/pnpm-optional": optional,
      },
    }),
  );
  const overrides = {
    NODE_ENV: "production",
    npm_config_production: "true",
    npm_config_omit: "dev\noptional",
    pnpm_config_prod: "true",
    pnpm_config_dev: "false",
    pnpm_config_optional: "false",
    pnpm_config_offline: "true",
    PNPM_DISABLE_SELF_UPDATE_CHECK: "1",
  };
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, overrides);
  try {
    const preview = await setupDirectory(root);
    assert.deepEqual(preview.blockers, []);
    const result = await setupDirectory(
      root,
      true,
      true,
      undefined,
      undefined,
      { expectedPlanId: preview.id },
    );
    assert.equal(result.installation?.completed.length, 1);
    const installed = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "-e",
          "console.log(JSON.stringify(['pnpm-runtime','pnpm-development','pnpm-optional'].map(name=>require('@devteleport-collection/'+name))))",
        ],
        { cwd: root, encoding: "utf8" },
      ),
    );
    assert.deepEqual(installed, [
      "pnpm-runtime",
      "pnpm-development",
      "pnpm-optional",
    ]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
