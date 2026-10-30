import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-ui-"));
let app;
try {
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "hello.txt"), "desktop roundtrip");
  const env = {
    ...process.env,
    DEVTELEPORT_NODE: "/missing-node-for-test",
    DEVTELEPORT_USER_DATA: path.join(temp, "user-data"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    ...(process.env.DEVTELEPORT_APP_BINARY
      ? { executablePath: process.env.DEVTELEPORT_APP_BINARY, args: [] }
      : { args: ["apps/desktop/main.cjs"] }),
    env,
  });
  const page = await app.firstWindow();
  async function done() {
    await page.waitForFunction(() =>
      ["Completed", "Needs attention"].includes(
        document.getElementById("status").textContent,
      ),
    );
    if ((await page.locator("#status").textContent()) !== "Completed")
      throw new Error(await page.locator("#result").textContent());
  }

  await page.waitForSelector("#source");
  await page.locator("#welcome").waitFor({ state: "visible" });
  await page.locator("#welcomeDone").click();
  const native = await app.evaluate(() => ({
    architecture: process.arch,
    electron: process.versions.electron,
  }));
  assert.equal(
    native.architecture,
    process.env.DEVTELEPORT_EXPECT_ARCH || process.arch,
  );

  await page.locator("#source").fill(root);
  await page.locator('[data-action="inspect"]').click();
  await done();
  assert((await page.locator("#result").textContent()).includes("supported"));
  await page.locator('[data-view="capture"]').click();
  await page.locator("#name").fill("desktop");
  await page.locator("#output").fill(temp);
  await page.locator("#capturePassword").fill("desktop passphrase for testing");
  await page.locator('[data-action="capture"][data-dry="true"]').click();
  await done();
  await page.locator('[data-action="capture"].primary').click();
  await done();
  const archive = path.join(temp, "desktop.dtp");
  await fs.stat(archive);
  await fs.rm(root, { recursive: true });
  await page.locator('[data-view="restore"]').click();
  await page.locator("#snapshot").fill(archive);
  const target = path.join(temp, "restored");
  await page.locator("#target").fill(target);
  await page.locator("#restorePassword").fill("desktop passphrase for testing");
  await page.locator('[data-action="restore"][data-dry="true"]').click();
  await done();
  await page.locator('[data-action="restore"].primary').click();
  await done();
  assert.equal(
    await fs.readFile(path.join(target, "hello.txt"), "utf8"),
    "desktop roundtrip",
  );
  await page.locator("#source").fill(target);
  await page.locator('[data-action="verify"]').click();
  await done();
  assert((await page.locator("#result").textContent()).includes('"ok": true'));
  const settings = JSON.parse(
    await fs.readFile(
      path.join(temp, "user-data", "workspace-settings.json"),
      "utf8",
    ),
  );
  assert.equal(settings.source, target);
  assert(!JSON.stringify(settings).includes("password"));
  const backend = await page.evaluate(() =>
    window.teleport.operation({
      action: "diagnostics",
      toolDirectories: document.getElementById("toolDirectories").value,
    }),
  );
  assert.equal(backend.architecture, native.architecture);
  native.backendArchitecture = backend.architecture;
  await page.locator('[data-view="capture"]').click();
  await page.locator("#name").fill("cancelled");
  await page.locator('[data-action="capture"][data-dry="true"]').click();
  await done();
  await page.evaluate(() =>
    window.teleport.onProgress(() => document.getElementById("cancel").click()),
  );
  await page.locator('[data-action="capture"].primary').click();
  await page.waitForFunction(
    () => document.getElementById("status").textContent === "Needs attention",
  );
  assert((await page.locator("#result").textContent()).includes("cancelled"));
  await assert.rejects(fs.stat(path.join(temp, "cancelled.dtp")));
  await fs.mkdir("dist", { recursive: true });
  await page.locator('[data-view="settings"]').click();
  await page.locator("#theme").selectOption("dark");
  await page.locator('[data-view="dashboard"]').click();
  await page.screenshot({ path: "dist/desktop-smoke.png", fullPage: true });
  await page.locator('[data-view="settings"]').click();
  await page.locator("#theme").selectOption("light");
  await page.locator('[data-view="dashboard"]').click();
  await page.screenshot({ path: "dist/desktop-light.png", fullPage: true });
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    ),
    "#f4f6fa",
  );
  await fs.writeFile(
    "dist/native-runtime.json",
    JSON.stringify(native, null, 2),
  );
  console.log(
    "PASS: Electron inspect, capture review, encrypted capture, source removal, restore and verification.",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
