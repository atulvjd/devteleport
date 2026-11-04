import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import {
  planPython,
  executePython,
  pythonMetadata,
} from "../packages/core/python-setup.ts";
import type { SnapshotEntry } from "../packages/core/types.ts";

const execute = promisify(execFile);
async function plan(values: Record<string, string>) {
  const files: SnapshotEntry[] = Object.entries(values).map(([file, text]) => ({
    type: "file",
    path: file,
    mode: 0o600,
    data: "",
    size: Buffer.byteLength(text),
    checksum: crypto.createHash("sha256").update(text).digest("hex"),
  }));
  return planPython(files, async (file) => values[file] ?? null);
}
test("Python requirements inventory follows local includes and never exposes private values", async () => {
  const packages = await plan({
    "api/requirements.txt":
      "-r requirements/base.txt\n-c requirements/constraints.txt\nflask>=3\nprivate-client @ https://secret-user:private-registry-password@example.invalid/client.whl\n",
    "api/requirements-dev.txt": "pytest==8.0\n",
    "api/requirements/base.txt": "requests\n",
    "api/requirements/constraints.txt": "urllib3<3\n",
  });
  assert.equal(packages.length, 1);
  assert.equal(packages[0].manager, "python3");
  assert.equal(packages[0].ecosystem, "Python");
  assert.equal(packages[0].installKey, "python3:api");
  assert.deepEqual(packages[0].dependencies, [
    "flask",
    "private-client",
    "pytest",
    "requests",
    "urllib3",
  ]);
  assert(!JSON.stringify(packages).includes("private-registry-password"));
  assert.deepEqual(packages[0].command.slice(-4), [
    "-r",
    "requirements.txt",
    "-r",
    "requirements-dev.txt",
  ]);
  assert.deepEqual(packages[0].blockers, []);
});
test("Python requirements reject remote includes, escaping local paths and destination overrides", async () => {
  for (const requirements of [
    "-r ../../outside.txt",
    "-r https://example.invalid/private.txt",
    "../outside.whl",
    "--target=/tmp/other",
    "--prefix /tmp/global",
    "-e ../../other",
    "package @ file:///tmp/outside.whl",
    "package @ ../../outside.whl",
    "--find-links ../../outside",
    "--find-links '../../outside'",
  ]) {
    const packages = await plan({ "requirements.txt": requirements });
    assert(packages[0].blockers.length, requirements);
  }
  const nested = await plan({
    "api/requirements.txt": "-r requirements/base.txt",
    "api/requirements/base.txt": "../../../outside.whl",
  });
  assert(nested[0].blockers.length);
});
test("Python pyproject, uv and Poetry plans distinguish their managers and keep unsupported layouts explicit", async () => {
  const plain = (
    await plan({
      "pyproject.toml":
        '[project]\nname="sample-app"\ndependencies=["requests", "pydantic>=2"]\nrequires-python=">=3.9"\n[project.optional-dependencies]\ntest=["pytest"]\n[build-system]\nrequires=["setuptools"]\n',
    })
  )[0];
  assert.equal(plain.manager, "python3");
  assert.deepEqual(plain.dependencies, [
    "pydantic",
    "pytest",
    "requests",
    "setuptools",
  ]);
  assert.equal(plain.command.at(-1), ".");
  const uv = (
    await plan({
      "pyproject.toml": '[project]\nname="uv-app"\ndependencies=[]\n',
      "uv.lock": "version = 1\n",
    })
  )[0];
  assert.equal(uv.manager, "uv");
  assert(uv.command.includes("--locked"));
  assert(uv.command.includes("--no-managed-python"));
  const poetry = (
    await plan({
      "pyproject.toml":
        '[tool.poetry]\nname="poetry-app"\n[tool.poetry.dependencies]\npython="^3.9"\nrequests="^2"\n',
      "poetry.lock": "# fixture\n",
    })
  )[0];
  assert.equal(poetry.manager, "poetry");
  assert.deepEqual(poetry.dependencies, ["requests"]);
  const pipenv = (await plan({ Pipfile: "[packages]\n" }))[0];
  assert(pipenv.blockers.some((value) => value.includes("Pipenv")));
  const workspace = (
    await plan({
      "pyproject.toml":
        '[project]\nname="uv-app"\n[tool.uv.workspace]\nmembers=["packages/*"]\n',
      "uv.lock": "version=1",
    })
  )[0];
  assert(workspace.blockers.some((value) => value.includes("workspace")));
  assert(pythonMetadata("api/requirements/constraints.txt"));
  assert(!pythonMetadata("private-notes.txt"));
});
test("Python requirement profile entrypoints are detected without silently merging ambiguous environments", async () => {
  const onlyProduction = await plan({
    "api/requirements-prod.txt": "fastapi==1\n",
  });
  assert.equal(onlyProduction.length, 1);
  assert.equal(onlyProduction[0].directory, "api");
  assert.deepEqual(onlyProduction[0].command.slice(-2), [
    "-r",
    "requirements-prod.txt",
  ]);
  assert.deepEqual(onlyProduction[0].dependencies, ["fastapi"]);
  assert.deepEqual(onlyProduction[0].blockers, []);
  const onlyFolder = await plan({ "api/requirements/base.txt": "requests\n" });
  assert.equal(onlyFolder.length, 1);
  assert.equal(onlyFolder[0].directory, "api");
  assert.deepEqual(onlyFolder[0].command.slice(-2), [
    "-r",
    "requirements/base.txt",
  ]);
  const profiles = await plan({
    "requirements/base.txt": "requests\n",
    "requirements/dev.txt": "pytest\n",
    "requirements/prod.txt": "gunicorn\n",
  });
  assert.equal(profiles.length, 1);
  assert(
    profiles[0].blockers.some((value) => value.includes("explicit entrypoint")),
  );
  assert.deepEqual(profiles[0].dependencies, [
    "gunicorn",
    "pytest",
    "requests",
  ]);
  const explicit = await plan({
    "requirements.txt": "-r requirements/dev.txt\n",
    "requirements/base.txt": "requests\n",
    "requirements/dev.txt": "-r base.txt\npytest\n",
    "requirements/prod.txt": "gunicorn\n",
  });
  assert.deepEqual(explicit[0].blockers, []);
  assert.deepEqual(explicit[0].dependencies, ["pytest", "requests"]);
});
async function temp(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-python-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return fs.realpath(root);
}
test("Python installer refuses unowned and linked virtual environments before invoking tools", async (t) => {
  const pkg = (await plan({ "requirements.txt": "requests" }))[0];
  for (const linked of [false, true]) {
    const root = await temp(t);
    await fs.mkdir(path.join(root, ".devteleport"));
    const environment = path.join(root, ".devteleport/python-env");
    if (linked) await fs.symlink(os.tmpdir(), environment);
    else await fs.mkdir(environment);
    let calls = 0;
    await assert.rejects(
      executePython(
        pkg,
        root,
        "python3",
        async () => {
          calls++;
        },
        process.env,
      ),
    );
    assert.equal(calls, 0);
  }
});
test("Python installs an offline wheel only into its owned environment and retries in place", async (t) => {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    t.skip("python3 is not installed");
    return;
  }
  const root = await temp(t),
    wheel = path.join(root, "dtp_python_fixture-1.0.0-py3-none-any.whl");
  execFileSync("python3", [
    "-c",
    [
      "import zipfile,sys",
      "z=zipfile.ZipFile(sys.argv[1],'w')",
      "z.writestr('dtp_python_fixture/__init__.py',\"VALUE = 'local fixture'\\n\")",
      "z.writestr('dtp_python_fixture-1.0.0.dist-info/METADATA','Metadata-Version: 2.1\\nName: dtp-python-fixture\\nVersion: 1.0.0\\n')",
      "z.writestr('dtp_python_fixture-1.0.0.dist-info/WHEEL','Wheel-Version: 1.0\\nGenerator: devteleport-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')",
      "z.writestr('dtp_python_fixture-1.0.0.dist-info/RECORD','')",
      "z.close()",
    ].join(";"),
    wheel,
  ]);
  const requirements = path.basename(wheel) + "\n";
  await fs.writeFile(path.join(root, "requirements.txt"), requirements);
  const pkg = (await plan({ "requirements.txt": requirements }))[0];
  const invocations: {
    file: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  }[] = [];
  const runner = async (
    file: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
  ) => {
    invocations.push({ file, args, env: env! });
    return execute(file, args, {
      cwd: root,
      env,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
  };
  const poisoned = {
    ...process.env,
    PIP_NO_INDEX: "1",
    PIP_TARGET: path.join(root, "wrong-target"),
    PIP_PREFIX: "/tmp/not-used",
    PIP_NO_DEPS: "true",
    PYTHONPATH: "/tmp/not-used",
  };
  assert.equal(
    await executePython(pkg, root, "python3", runner, poisoned),
    true,
  );
  const privatePython = path.join(root, ".devteleport/python-env/bin/python");
  assert.equal(
    execFileSync(
      privatePython,
      ["-c", "import dtp_python_fixture;print(dtp_python_fixture.VALUE)"],
      { encoding: "utf8" },
    ).trim(),
    "local fixture",
  );
  await assert.rejects(fs.stat(path.join(root, "wrong-target")), {
    code: "ENOENT",
  });
  assert.equal(invocations[1].args[1], "venv");
  assert.equal(invocations[2].file, privatePython);
  assert.equal(invocations[2].env.PIP_CONFIG_FILE, os.devNull);
  assert.equal(invocations[2].env.PIP_NO_DEPS, undefined);
  assert.equal(invocations[2].env.PYTHONPATH, undefined);
  assert.equal(
    await executePython(pkg, root, "python3", runner, poisoned),
    true,
  );
  assert.equal(
    invocations.filter((value) => value.args.includes("venv")).length,
    1,
  );
  assert.equal(invocations.at(-1)?.file, privatePython);
  for (const manager of ["uv", "poetry"]) {
    const command =
      manager === "uv"
        ? [
            "uv",
            "sync",
            "--locked",
            "--all-packages",
            "--all-groups",
            "--no-managed-python",
          ]
        : ["poetry", "install", "--no-interaction"];
    let invoked = false;
    await executePython(
      { ...pkg, manager, command },
      root,
      "/fixture/" + manager,
      async (file, args, env) => {
        if (file === "/fixture/" + manager) {
          invoked = true;
          assert.deepEqual(args, command.slice(1));
          assert.equal(
            env?.VIRTUAL_ENV,
            path.join(root, ".devteleport/python-env"),
          );
          assert.equal(env?.UV_PROJECT_ENVIRONMENT, env?.VIRTUAL_ENV);
          assert.equal(env?.UV_PYTHON, privatePython);
          assert.equal(env?.UV_PYTHON_DOWNLOADS, "never");
          assert.equal(env?.UV_NO_MANAGED_PYTHON, "1");
          assert.equal(env?.POETRY_VIRTUALENVS_CREATE, "false");
          return { stdout: "", stderr: "" };
        }
        return runner(file, args, env);
      },
      poisoned,
      "python3",
    );
    assert(invoked);
  }
  await fs.unlink(privatePython);
  await fs.symlink("/bin/sh", privatePython);
  await assert.rejects(
    executePython(pkg, root, "python3", runner, poisoned),
    /another executable/,
  );
});
