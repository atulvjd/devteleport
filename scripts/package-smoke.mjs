import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
      path.resolve("dist/devteleport-0.1.0.tgz"),
    ],
    { stdio: "pipe" },
  );
  const output = execFileSync(
    path.join(temp, "bin", "devteleport"),
    ["inspect", "--root", path.resolve("examples/hello")],
    { encoding: "utf8" },
  );
  assert.equal(JSON.parse(output).root, await fs.realpath("examples/hello"));
  console.log(
    "PASS: installed CLI tarball runs from node_modules through its executable bin.",
  );
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
