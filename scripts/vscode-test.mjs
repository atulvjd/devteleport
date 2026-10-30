import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-vscode-"));
try {
  const root = path.join(temp, "workspace");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "hello.txt"), "real host");
  await fs.mkdir(path.join(temp, "profile", "User"), { recursive: true });
  await fs.writeFile(
    path.join(temp, "profile", "User", "settings.json"),
    JSON.stringify({
      "chat.disableAIFeatures": true,
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
      "security.workspace.trust.startupPrompt": "never",
    }),
  );
  let extensionPath = path.resolve("apps/vscode-extension");
  if (process.env.DTP_TEST_VSIX) {
    execFileSync("unzip", [
      "-q",
      path.resolve(process.env.DTP_TEST_VSIX),
      "-d",
      path.join(temp, "vsix"),
    ]);
    extensionPath = path.join(temp, "vsix", "extension");
  }
  const binary =
    process.env.DEVTELEPORT_VSCODE_BINARY ||
    "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders";
  const env = {
    ...process.env,
    DTP_TEST_NODE: process.execPath,
    DTP_TEST_UNTRUSTED: process.env.DTP_TEST_UNTRUSTED || "0",
    DTP_TEST_CLI: path.resolve("apps/cli/main.ts"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const child = spawn(
    binary,
    [
      "--user-data-dir",
      path.join(temp, "profile"),
      "--extensions-dir",
      path.join(temp, "extensions"),
      "--extensionDevelopmentPath=" + extensionPath,
      "--extensionTestsPath=" + path.resolve("tests/vscode-host/index.cjs"),
      ...(process.env.DTP_TEST_UNTRUSTED === "1"
        ? []
        : ["--disable-workspace-trust"]),
      "--skip-welcome",
      "--skip-release-notes",
      root,
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("VS Code host timeout: " + output.slice(-5000)));
    }, 120000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  assert.equal(code, 0, output.slice(-5000));
  const result = JSON.parse(
    await fs.readFile(path.join(temp, "host-result.json"), "utf8"),
  );
  assert(result.passed);
  console.log("PASS actual VS Code extension host:", result);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
