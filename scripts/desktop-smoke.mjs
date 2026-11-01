import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-ui-"));
let app;
try {
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "hello.txt"), "desktop roundtrip");
  await fs.mkdir(path.join(root, "cms"));
  for (const [dir, script] of [
    ["", "dev"],
    ["cms", "develop"],
  ]) {
    await fs.writeFile(
      path.join(root, dir, "package.json"),
      JSON.stringify({
        name: dir || "frontend",
        version: "1.0.0",
        private: true,
        scripts: { postinstall: "node install.cjs", [script]: "node app.cjs" },
      }),
    );
    await fs.writeFile(
      path.join(root, dir, "install.cjs"),
      "require('node:fs').writeFileSync('dependencies-ready.txt','ready');",
    );
    await fs.writeFile(
      path.join(root, dir, "app.cjs"),
      "if(require('node:fs').readFileSync('dependencies-ready.txt','utf8')!=='ready')process.exit(1);console.log('started');",
    );
  }
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
    await page.waitForFunction(
      () =>
        document.getElementById("cancel").hidden &&
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
  assert(await page.locator("#includeDb").isDisabled());
  assert(await page.locator("#includeVolumes").isDisabled());
  assert(
    (await page.locator("#databaseAvailability").textContent()).includes(
      "Not configured",
    ),
  );
  // Preserve the preflight regression even if renderer state is manipulated.
  await page.evaluate(() => {
    document.getElementById("includeDb").checked = true;
    document.getElementById("includeVolumes").checked = true;
  });
  await page.locator('[data-action="capture"][data-dry="true"]').click();
  await page.waitForFunction(
    () =>
      document.getElementById("cancel").hidden &&
      document.getElementById("status").textContent === "Needs attention",
  );
  const missingConfiguration = await page.locator("#result").textContent();
  assert(
    missingConfiguration.includes("PostgreSQL databases or Docker volumes"),
  );
  assert(missingConfiguration.includes("Uncheck"));
  await assert.rejects(fs.stat(path.join(temp, "desktop.dtp")), {
    code: "ENOENT",
  });
  // Unavailable selections are reset after the failed preflight.
  assert(!(await page.locator("#includeDb").isChecked()));
  assert(!(await page.locator("#includeVolumes").isChecked()));
  const lockedImmediately = await page.evaluate(() => {
    // Hold settings persistence until the test releases it. A fast local disk
    // must not hide a retry reading the previous operation's terminal status.
    const save = persist;
    let release;
    persist = async () => {
      await new Promise((resolve) => (release = resolve));
      return save();
    };
    window.resumeSmokeSettings = () => {
      persist = save;
      release();
      delete window.resumeSmokeSettings;
    };
    const button = document.querySelector(
      '[data-action="capture"][data-dry="true"]',
    );
    button.click();
    return (
      button.disabled &&
      document.getElementById("status").textContent === "Working…"
    );
  });
  assert(
    lockedImmediately,
    "Review must immediately enter a busy state before saving preferences",
  );
  await page.evaluate(() => window.resumeSmokeSettings());
  await done();
  assert(await page.locator("#captureReview").isVisible());
  assert(!(await page.locator('[data-action="capture"].primary').isDisabled()));
  await page.locator("#name").fill("changed-after-review");
  assert(await page.locator('[data-action="capture"].primary').isDisabled());
  await page.locator("#name").fill("desktop");
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
  assert(
    !(await page.locator("#install").isChecked()),
    "Executing dependency scripts must require opt-in",
  );
  await page.locator("#install").check();
  await page.locator('[data-action="restore"][data-dry="true"]').click();
  await done();
  assert(await page.locator("#restoreSetup").isVisible());
  const dependencyGuide = await page.locator("#setupPackages").textContent();
  assert(dependencyGuide.includes("Main project"));
  assert(dependencyGuide.includes("cms"));
  assert(
    dependencyGuide.includes("npm install"),
    "Missing lockfiles must use install, not ci",
  );
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
  await page.locator('[data-action="restore"].primary').click();
  await done();
  assert(
    (await page.locator("#setupIntro").textContent()).includes(
      "Dependency installation completed",
    ),
  );
  assert(
    (await page.locator("#setupPackages").textContent()).includes(
      "npm run develop",
    ),
  );
  for (const [dir, script] of [
    ["", "dev"],
    ["cms", "develop"],
  ]) {
    assert.equal(
      await fs.readFile(
        path.join(target, dir, "dependencies-ready.txt"),
        "utf8",
      ),
      "ready",
    );
    assert.match(
      execFileSync("npm", ["run", script], {
        cwd: path.join(target, dir),
        encoding: "utf8",
      }),
      /started/,
    );
  }
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
  const crypto = await import("node:crypto"),
    { pathToFileURL } = await import("node:url");
  const keys = crypto.generateKeyPairSync("ed25519"),
    release = Buffer.from(
      JSON.stringify({
        version: "9.0.0",
        channel: "stable",
        notes: "runtime test",
        artifacts: [
          {
            platform: "darwin",
            architecture: "arm64",
            url: "https://github.com/atulvjd/devteleport/releases/download/v9.0.0/app.zip",
            sha256: "a".repeat(64),
          },
        ],
      }),
    ),
    signature = crypto.sign(null, release, keys.privateKey).toString("base64");
  const updatesUrl = pathToFileURL(
    process.env.DEVTELEPORT_APP_BINARY
      ? path.resolve(
          path.dirname(process.env.DEVTELEPORT_APP_BINARY),
          "../Resources/backend/packages/core/updates.js",
        )
      : path.resolve("dist/backend/packages/core/updates.js"),
  ).href;
  const cryptoCheck = path.join(temp, "runtime-crypto.cjs");
  await fs.writeFile(
    cryptoCheck,
    "const input=JSON.parse(process.argv[2]);import(input.url).then(module=>{const result=module.validateRelease(Buffer.from(input.manifest,'base64'),Buffer.from(input.signature,'base64'),input.publicKey,'0.2.0');process.stdout.write(JSON.stringify({state:result.state,architecture:process.arch}),()=>process.exit(0));}).catch(error=>{console.error(error.message);process.exit(1);});",
  );
  const cryptoInput = {
    url: updatesUrl,
    manifest: release.toString("base64"),
    signature,
    publicKey: keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
  const cryptoResult = await app.evaluate(
    ({ utilityProcess }, input) =>
      new Promise((resolve, reject) => {
        const child = utilityProcess.fork(
          input.script,
          [JSON.stringify(input.data)],
          { stdio: "pipe" },
        );
        let output = "",
          error = "";
        child.stdout.on("data", (bytes) => (output += bytes));
        child.stderr.on("data", (bytes) => (error += bytes));
        child.once("exit", (code) => {
          if (code !== 0) reject(new Error(error));
          else resolve(JSON.parse(output));
        });
      }),
    { script: cryptoCheck, data: cryptoInput },
  );
  assert.equal(cryptoResult.state, "available");
  assert.equal(cryptoResult.architecture, native.architecture);
  native.signedMetadataVerification = cryptoResult.state;

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
  const expectedBounds = await app.evaluate(
    ({ BrowserWindow, Menu, screen }) => {
      const menu = Menu.getApplicationMenu();
      if (!menu?.items.some((item) => item.label === "Window"))
        throw new Error("Native Window menu missing");
      const window = BrowserWindow.getAllWindows()[0];
      const workArea = screen.getDisplayMatching(window.getBounds()).workArea;
      const [minWidth, minHeight] = window.getMinimumSize();
      // Hosted macOS can have a 1024 x 684 work area. Use bounds that fit it
      // even on a larger local display, without extending beyond any work area.
      const width = Math.max(minWidth, Math.min(980, workArea.width));
      const height = Math.max(minHeight, Math.min(640, workArea.height));
      if (width > workArea.width || height > workArea.height)
        throw new Error(
          "Desktop smoke requires a work area of at least 800 x 600",
        );
      window.setBounds({
        x: workArea.x + Math.min(40, workArea.width - width),
        y: workArea.y + Math.min(40, workArea.height - height),
        width,
        height,
      });
      return window.getBounds();
    },
  );
  await app.close();
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(temp, "user-data", "window.json"), "utf8"),
    ),
    expectedBounds,
    "The closed window must persist its exact native bounds",
  );
  app = await electron.launch({
    ...(process.env.DEVTELEPORT_APP_BINARY
      ? { executablePath: process.env.DEVTELEPORT_APP_BINARY, args: [] }
      : { args: ["apps/desktop/main.cjs"] }),
    env,
  });
  const reopened = await app.firstWindow();
  await reopened.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.equal(
    await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
    "light",
  );
  const restoredBounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  assert.deepEqual(restoredBounds, expectedBounds);
  native.windowBoundsRestored = true;
  native.guidedDependencyRestore = {
    previewBeforeDestination: true,
    installedPackages: [".", "cms"],
    startupCommandsPassed: ["npm run dev", "npm run develop"],
  };
  native.restoredWindowBounds = restoredBounds;
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
