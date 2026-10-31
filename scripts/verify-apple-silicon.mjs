import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import { stripVTControlCharacters } from "node:util";
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const evidence = path.resolve("dist/evidence");
await fs.mkdir(evidence, { recursive: true });
const checks = [];
const bundle = path.resolve(
  process.env.DEVTELEPORT_APP_BUNDLE ||
    "dist/desktop/mac-arm64/DevTeleport.app",
);
async function stage(name, cmd, args, env = {}) {
  const file = path.join(evidence, "verify-" + name + ".log");
  const output = [];
  let size = 0;
  const start = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (data) => {
      size += data.length;
      if (size < 8 * 1024 * 1024) output.push(data);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => resolve({ code: null, error: error.message }));
    child.on("close", (code) => resolve({ code }));
  });
  await fs.writeFile(file, Buffer.concat(output));
  const log = stripVTControlCharacters(Buffer.concat(output).toString("utf8"));
  const status =
    result.code === 0
      ? /\bskipped [1-9]|\bSKIP(?:PED)?\b/.test(log)
        ? "SKIPPED"
        : "PASS"
      : result.code === null
        ? "BLOCKED"
        : "FAIL";
  checks.push({
    name,
    status,
    exitCode: result.code,
    milliseconds: Date.now() - start,
    log: file,
    ...(result.error ? { error: result.error } : {}),
  });
  console.log(status + " " + name);
}
if (process.platform !== "darwin" || process.arch !== "arm64")
  checks.push({
    name: "native-host-and-node",
    status: "FAIL",
    detail: process.platform + "-" + process.arch,
  });
else
  checks.push({
    name: "native-host-and-node",
    status: "PASS",
    detail: {
      platform: process.platform,
      architecture: process.arch,
      cpu: os.cpus()[0]?.model,
      memoryBytes: os.totalmem(),
    },
  });
if (checks[0].status === "PASS") {
  await stage("strict-types", "npm", ["run", "check"]);
  await stage("core-security-format-tests", "npm", ["test"]);
  await stage("tls-transfer", "npm", ["run", "test:transfer"]);
  await stage("signed-update-https", "npm", ["run", "test:updates"]);
  await stage("desktop-tls-workflow", "npm", ["run", "test:desktop:transfer"]);
  await stage("postgres", "npm", ["run", "test:postgres"]);
  await stage("postgres-versions", "npm", ["run", "test:pg-versions"]);
  await stage("docker-live", "npm", ["run", "test:docker:live"]);
  await stage("independent-restore", "npm", ["run", "test:full"]);
  await stage("cli-package", "npm", ["run", "package:cli"]);
  await stage("installed-cli", "npm", ["run", "test:package"]);
  await stage("vsix-package", "npm", ["run", "package:extension"]);
  await stage("actual-vscode-host", "npm", ["run", "test:vscode"], {
    DTP_TEST_VSIX: path.resolve(
      `apps/vscode-extension/devteleport-${version}.vsix`,
    ),
  });
  await stage("untrusted-vscode-host", "npm", ["run", "test:vscode"], {
    DTP_TEST_VSIX: path.resolve(
      `apps/vscode-extension/devteleport-${version}.vsix`,
    ),
    DTP_TEST_UNTRUSTED: "1",
  });
  await stage("bundle-architecture-and-integrity", process.execPath, [
    "scripts/architecture.mjs",
  ]);
  await stage("distributed-dmg-integrity", process.execPath, [
    "scripts/verify-distribution.mjs",
  ]);
  await stage(
    "packaged-desktop",
    process.execPath,
    ["scripts/desktop-smoke.mjs"],
    {
      DEVTELEPORT_APP_BINARY: path.join(bundle, "Contents/MacOS/DevTeleport"),
      DEVTELEPORT_EXPECT_ARCH: "arm64",
    },
  );
  await stage(
    "desktop-visual-layout",
    process.execPath,
    ["scripts/desktop-visual.mjs"],
    {
      DEVTELEPORT_APP_BINARY: path.join(bundle, "Contents/MacOS/DevTeleport"),
    },
  );
}
const report = {
  createdAt: new Date().toISOString(),
  checks,
  ok: checks.length >= 14 && checks.every((check) => check.status === "PASS"),
  releaseGates: [
    {
      name: "Developer ID signing and notarization",
      status: "BLOCKED",
      reason:
        "Requires authorized Apple credentials and real verification; not inferred from this runtime test.",
    },
    {
      name: "Physical two-Mac transfer",
      status: "BLOCKED",
      reason:
        "Directory/container/localhost tests do not certify two physical Macs.",
    },
    {
      name: "Remote CI",
      status: "BLOCKED",
      reason: "Requires authorized push/run; no remote publication performed.",
    },
  ],
};
await fs.writeFile(
  path.join(evidence, "apple-silicon-verification.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  "Runtime verification " +
    (report.ok ? "PASS" : "FAIL/BLOCKED") +
    ". Release gates are reported separately.",
);
if (!report.ok) process.exitCode = 1;
