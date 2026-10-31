import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-install-"));
try {
  execFileSync(
    "npm",
    [
      "install",
      "--global",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      path.resolve("dist/.npm-cache"),
      "--prefix",
      temp,
      path.resolve(`dist/devteleport-${version}.tgz`),
    ],
    { stdio: "pipe" },
  );
  const workspace = path.join(temp, "workspace");
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, "hello.txt"), "installed package");
  const output = execFileSync(
    path.join(temp, "bin", "devteleport"),
    ["inspect", "--root", workspace],
    { encoding: "utf8" },
  );
  assert.equal(JSON.parse(output).root, await fs.realpath(workspace));
  const installed = path.join(temp, "bin", "devteleport");
  const env = {
    ...process.env,
    DEVTELEPORT_PASSWORD: "installed CLI diff passphrase",
  };
  execFileSync(
    installed,
    ["capture", "--root", workspace, "--name", "installed", "--output", temp],
    { env, stdio: "pipe" },
  );
  const archive = path.join(temp, "installed.dtp");
  assert.equal((await fs.readFile(archive)).subarray(0, 4).toString(), "DTP2");
  const diff = () =>
    execFileSync(installed, ["diff", archive, workspace], {
      env,
      encoding: "utf8",
    });
  assert.equal(JSON.parse(diff()).identical, true);
  await fs.writeFile(
    path.join(workspace, "hello.txt"),
    "changed after capture",
  );
  assert.throws(diff, (error) => {
    assert.equal(error.status, 2);
    assert.deepEqual(JSON.parse(error.stdout).modified, [
      { path: "hello.txt", reasons: ["content"] },
    ]);
    return true;
  });
  await fs.rm(workspace, { recursive: true });
  const restored = path.join(temp, "restored");
  execFileSync(installed, ["restore", archive, "--target", restored], {
    env,
    stdio: "pipe",
  });
  assert.equal(
    await fs.readFile(path.join(restored, "hello.txt"), "utf8"),
    "installed package",
  );
  const verification = JSON.parse(
    execFileSync(installed, ["verify", restored, "--snapshot", archive], {
      env,
      encoding: "utf8",
    }),
  );
  assert.equal(verification.ok, true);
  console.log(
    "PASS: installed CLI inspects, captures format 2, diffs, restores after source removal and verifies the authenticated archive without a repository clone.",
  );
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
