import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { capture, restore } from "../packages/core/index.ts";
import {
  setupDirectory,
  type InstallationReport,
} from "../packages/core/setup.ts";

test("format 2 installs co-located Node and Python dependencies after source removal and retries only the selected ecosystem", async (t) => {
  if (spawnSync("python3", ["--version"], { encoding: "utf8" }).status !== 0) {
    t.skip("python3 is unavailable");
    return;
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-polyglot-"));
  const temp = await fs.realpath(temporary);
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const originalEnv = {
    PIP_NO_INDEX: process.env.PIP_NO_INDEX,
    npm_config_cache: process.env.npm_config_cache,
  };
  process.env.PIP_NO_INDEX = "1";
  process.env.npm_config_cache = path.join(temp, "npm-cache");
  t.after(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const source = path.join(temp, "source"),
    target = path.join(temp, "restored");
  await fs.mkdir(source);
  await fs.writeFile(
    path.join(source, "README.md"),
    "Node and Python source must survive installation and selective retry.\n",
  );
  await fs.writeFile(
    path.join(source, "package.json"),
    JSON.stringify({
      name: "polyglot-web",
      version: "1.0.0",
      private: true,
      scripts: { postinstall: "node install.cjs", dev: "node app.cjs" },
    }),
  );
  await fs.writeFile(
    path.join(source, "install.cjs"),
    "const fs=require('node:fs');const f='node-install-count.txt';fs.writeFileSync(f,String((fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0)+1));\n",
  );
  await fs.writeFile(
    path.join(source, "app.cjs"),
    "console.log('web starts');\n",
  );
  const wheel = "polyglot_python_fixture-1.0.0-py3-none-any.whl";
  execFileSync("python3", [
    "-c",
    [
      "import zipfile,sys",
      "z=zipfile.ZipFile(sys.argv[1],'w')",
      "z.writestr('polyglot_python_fixture/__init__.py',\"VALUE = 'polyglot fixture'\\n\")",
      "z.writestr('polyglot_python_fixture-1.0.0.dist-info/METADATA','Metadata-Version: 2.1\\nName: polyglot-python-fixture\\nVersion: 1.0.0\\n')",
      "z.writestr('polyglot_python_fixture-1.0.0.dist-info/WHEEL','Wheel-Version: 1.0\\nGenerator: devteleport-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')",
      "z.writestr('polyglot_python_fixture-1.0.0.dist-info/RECORD','')",
      "z.close()",
    ].join(";"),
    path.join(source, wheel),
  ]);
  await fs.writeFile(path.join(source, "requirements.txt"), wheel + "\n");
  const password = "polyglot test archive passphrase";
  const archive = await capture({
    root: source,
    output: temp,
    name: "polyglot",
    format: 2,
    password,
  });
  await fs.rm(source, { recursive: true });
  const preview = await restore(archive.output, {
    target,
    password,
    install: true,
    dryRun: true,
  });
  assert.equal(preview.dependencies.packages.length, 2);
  assert.deepEqual(preview.dependencies.blockers, []);
  assert.deepEqual(
    preview.dependencies.packages.map((pkg) => pkg.installKey || pkg.directory),
    [".", "python3:."],
  );
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
  const reports: InstallationReport[] = [];
  const result = await restore(archive.output, {
    target,
    password,
    install: true,
    approveExecution: true,
    onInstallState: (report) => reports.push(report),
  });
  assert(result.verification.ok);
  const final = reports.at(-1)!;
  assert.equal(final.state, "installed");
  assert.deepEqual(
    final.packages.map((pkg) => pkg.key || pkg.directory),
    [".", "python3:."],
  );
  assert(final.packages.every((pkg) => pkg.state === "installed"));
  const readCount = () =>
    fs.readFile(path.join(target, "node-install-count.txt"), "utf8");
  assert.equal(await readCount(), "1");
  const privatePython = path.join(target, ".devteleport/python-env/bin/python");
  assert.equal(
    execFileSync(
      privatePython,
      [
        "-c",
        "import polyglot_python_fixture; print(polyglot_python_fixture.VALUE)",
      ],
      { encoding: "utf8" },
    ).trim(),
    "polyglot fixture",
  );
  const environmentBefore = await fs.stat(
    path.join(target, ".devteleport/python-env"),
  );
  await fs.unlink(archive.output);
  const reviewed = await setupDirectory(target);
  const retried = await setupDirectory(
    target,
    true,
    true,
    undefined,
    undefined,
    {
      expectedPlanId: reviewed.id,
      installDirectories: ["python3:."],
      onInstallState: (report) => reports.push(report),
    },
  );
  assert.equal(
    await readCount(),
    "1",
    "Selective Python retry must not rerun the successful Node installer",
  );
  assert.equal(
    retried.installation?.report.packages.find(
      (pkg) => (pkg.key || pkg.directory) === ".",
    )?.state,
    "not-selected",
  );
  assert.equal(
    retried.installation?.report.packages.find((pkg) => pkg.key === "python3:.")
      ?.state,
    "installed",
  );
  assert.equal(
    (await fs.stat(path.join(target, ".devteleport/python-env"))).ino,
    environmentBefore.ino,
  );
  assert.equal(
    await fs.readFile(path.join(target, "README.md"), "utf8"),
    "Node and Python source must survive installation and selective retry.\n",
  );
  const stale = await setupDirectory(target);
  await fs.appendFile(
    path.join(target, "requirements.txt"),
    "# changed review\n",
  );
  await assert.rejects(
    setupDirectory(target, true, true, undefined, undefined, {
      expectedPlanId: stale.id,
      installDirectories: ["."],
    }),
    /review changed/i,
  );
  assert.equal(await readCount(), "1");
});
