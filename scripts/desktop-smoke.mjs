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
  await fs.writeFile(
    path.join(root, ".env"),
    "APP_SECRET=desktop-env-private-fixture\n",
  );
  await fs.writeFile(path.join(root, ".gitignore"), ".env*\nlocal-cache/\n");
  await fs.writeFile(
    path.join(root, "pnpm-workspace.yaml"),
    "minimumReleaseAgeExclude:\n  - fixture-local-package\n",
  );
  await fs.mkdir(path.join(root, "local-cache"));
  await fs.writeFile(
    path.join(root, "local-cache", "state.txt"),
    "ignored local state",
  );
  for (let i = 0; i < 600; i++)
    await fs.writeFile(
      path.join(
        root,
        "local-cache",
        `entry-${String(i).padStart(4, "0")}-large-response-fixture-日本語-résumé.txt`,
      ),
      "ignored fixture",
    );
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "hello.txt", ".gitignore"], { cwd: root });
  for (const dir of [
    "node_modules/demo",
    "packages/web/node_modules/demo",
    ".next/cache",
  ]) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(
      path.join(root, dir, "generated.txt"),
      "reinstall or rebuild",
    );
  }
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
      "console.log('Live install step');console.log('API_TOKEN=fixture-console-private-token');console.log('<img data-console-injection>');console.error('Example build warning');setTimeout(()=>{require('node:fs').writeFileSync('dependencies-ready.txt','ready');},350);",
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
  const native = await app.evaluate(({ app }) => ({
    architecture: process.arch,
    electron: process.versions.electron,
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));
  const expectedVersion = JSON.parse(
    await fs.readFile("package.json", "utf8"),
  ).version;
  if (native.packaged)
    assert.equal(
      native.version,
      expectedVersion,
      "The packaged application must match the release version",
    );
  const desktopData = await page.evaluate(() => window.teleport.data());
  assert.equal(
    desktopData.version,
    expectedVersion,
    "The desktop UI/backend metadata must match the release version",
  );
  const rendererSecurity = await app.evaluate(({ BrowserWindow }) => {
    const prefs =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration,
      sandbox: prefs.sandbox,
    };
  });
  assert.deepEqual(rendererSecurity, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
  const rendererGlobals = await page.evaluate(() => ({
    require: typeof window.require,
    process: typeof window.process,
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')
      .content,
  }));
  assert.equal(rendererGlobals.require, "undefined");
  assert.equal(rendererGlobals.process, "undefined");
  assert(rendererGlobals.csp.includes("script-src 'self'"));
  native.rendererSecurity = rendererSecurity;
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
    missingConfiguration,
  );
  assert(missingConfiguration.includes("Uncheck"));
  assert.equal(
    await page.locator("#consoleState").textContent(),
    "Needs attention",
  );
  assert(
    (await page.locator("#consoleOutput").textContent()).includes(
      "Nothing has been captured",
    ),
  );
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
  assert(
    !(await page.locator("#includeIgnored").isChecked()),
    "Including ignored files/secrets must be explicit",
  );
  assert(
    !JSON.parse(await page.locator("#result").textContent()).files.some(
      (file) => file.path === ".env",
    ),
  );
  await page.locator("#includeIgnored").check();
  assert(
    await page.locator('[data-action="capture"].primary').isDisabled(),
    "Changing inclusion policy must invalidate the review",
  );
  await page.locator("#excludeGenerated").check();
  await page.locator('[data-action="capture"][data-dry="true"]').click();
  await done();
  const leanPreview = JSON.parse(await page.locator("#result").textContent());
  assert(leanPreview.capturePolicy.excludeGenerated);
  assert(leanPreview.omitted.includes("node_modules"));
  assert(leanPreview.omitted.includes("packages/web/node_modules"));
  assert(leanPreview.omitted.includes(".next"));
  assert(!leanPreview.files.some((f) => f.path.endsWith("generated.txt")));
  await page.locator("#excludeGenerated").uncheck();
  assert(
    await page.locator('[data-action="capture"].primary').isDisabled(),
    "Changing generated-folder selection invalidates review",
  );
  await page.locator("#excludeGenerated").check();
  await page.locator('[data-action="capture"][data-dry="true"]').click();
  await done();
  assert((await page.locator("#captureReview").textContent()).includes(".env"));
  assert(
    Buffer.byteLength(await page.locator("#result").textContent()) > 65536,
    "Ignored-file preview must exercise multi-chunk backend output",
  );
  assert.equal(
    JSON.parse(await page.locator("#result").textContent()).files.filter(
      (file) => file.path.includes("日本語-résumé"),
    ).length,
    600,
    "Multi-chunk UTF-8 filenames must be preserved in the preview",
  );
  assert(
    (await page.locator("#captureReview").textContent()).includes(
      "credentials",
    ),
  );
  assert(
    !(
      (await page.locator("#result").textContent()) +
      (await page.locator("#consoleOutput").textContent())
    ).includes("desktop-env-private-fixture"),
  );
  await fs.mkdir("dist/include-ignored", { recursive: true });
  await page.screenshot({
    path: "dist/include-ignored/capture-review.png",
    fullPage: true,
  });
  assert(!(await page.locator('[data-action="capture"].primary').isDisabled()));
  await page.locator("#name").fill("changed-after-review");
  assert(await page.locator('[data-action="capture"].primary').isDisabled());
  await page.locator("#name").fill("desktop");
  await page.locator('[data-action="capture"].primary').click();
  await done();
  const archive = path.join(temp, "desktop.dtp");
  assert.equal(await page.locator("#consoleState").textContent(), "Completed");
  assert(
    (await page.locator("#consoleCommand").textContent()).includes(
      "devteleport capture",
    ),
  );
  assert.equal(
    await page.locator('#consoleSteps li[data-state="done"]').count(),
    await page.locator("#consoleSteps li").count(),
  );
  assert(
    (await page.locator("#consoleOutput").textContent()).includes(
      "Authenticating created archive",
    ),
  );
  await fs.stat(archive);
  await fs.rm(root, { recursive: true });
  await page.locator('button[data-view="restore"]').click();
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
  assert(
    (await page.locator("#restoreReview").textContent()).includes(
      "credentials",
    ),
  );
  const dependencyGuide = await page.locator("#setupPackages").textContent();
  assert(dependencyGuide.includes("Main project"));
  assert(dependencyGuide.includes("cms"));
  assert(
    dependencyGuide.includes("npm install"),
    "Missing lockfiles must use install, not ci",
  );
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
  await page.locator('[data-action="restore"].primary').click();
  await page.waitForFunction(() =>
    document
      .getElementById("consoleOutput")
      .textContent.includes("Live install step"),
  );
  assert.equal(
    await page.locator("#consoleState").textContent(),
    "Running",
    "Installer output must appear before completion",
  );
  assert(!(await page.locator("#cancel").isHidden()));
  await fs.mkdir("dist/live-console", { recursive: true });
  await page
    .locator("#operationConsole")
    .screenshot({ path: "dist/live-console/console-running.png" });
  await done();
  const consoleText = await page.locator("#consoleOutput").textContent();
  assert(consoleText.includes("Live install step"));
  assert(consoleText.includes("Example build warning"));
  assert(consoleText.includes("[REDACTED]"));
  assert(!consoleText.includes("fixture-console-private-token"));
  assert(!consoleText.includes("desktop passphrase for testing"));
  assert(consoleText.includes("<img data-console-injection>"));
  assert.equal(
    await page.locator("#consoleOutput img").count(),
    0,
    "Project output must be rendered as text, never HTML",
  );
  await page
    .locator("#operationConsole")
    .screenshot({ path: "dist/live-console/console-complete.png" });
  assert(
    (await page.locator("#consoleMetrics").textContent()).includes(
      "Package installs",
    ),
  );
  assert.equal(
    await page.locator('#consoleSteps li[data-state="done"]').count(),
    await page.locator("#consoleSteps li").count(),
  );
  // Exercise native clipboard IPC without changing the user's system clipboard.
  await app.evaluate(({ clipboard }) => {
    globalThis.dtpConsoleClipboard = {
      original: clipboard.writeText,
      value: "",
    };
    clipboard.writeText = (text) => {
      globalThis.dtpConsoleClipboard.value = text;
    };
  });
  try {
    await page.locator("#consoleCopy").click();
    await page.waitForFunction(() =>
      document.getElementById("consoleNotice").textContent.includes("copied"),
    );
    const copied = await app.evaluate(
      () => globalThis.dtpConsoleClipboard.value,
    );
    assert(copied.includes("Live install step"));
    assert(!copied.includes("fixture-console-private-token"));
  } finally {
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = globalThis.dtpConsoleClipboard.original;
      delete globalThis.dtpConsoleClipboard;
    });
  }
  const logFile = path.join(temp, "activity.txt");
  await app.evaluate(({ dialog }, file) => {
    globalThis.dtpConsoleDialog = dialog.showSaveDialog;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, logFile);
  try {
    await page.locator("#consoleExport").click();
    await page.waitForFunction(() =>
      document.getElementById("consoleNotice").textContent.includes("saved"),
    );
    const exported = await fs.readFile(logFile, "utf8");
    assert(exported.includes("npm install"));
    assert(!exported.includes("fixture-console-private-token"));
    assert(!exported.includes("desktop passphrase for testing"));
    assert.equal((await fs.stat(logFile)).mode & 0o777, 0o600);
    await page.locator("#consoleExport").click();
    await page.waitForFunction(() =>
      document.getElementById("consoleNotice").textContent.includes("EEXIST"),
    );
    assert.equal(
      await fs.readFile(logFile, "utf8"),
      exported,
      "Log export must never overwrite an existing file",
    );
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = globalThis.dtpConsoleDialog;
      delete globalThis.dtpConsoleDialog;
    });
  }
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
  await fs.mkdir("dist/guided-restore", { recursive: true });
  await page.screenshot({
    path: "dist/guided-restore/restore-ready.png",
    fullPage: true,
  });
  assert.equal(
    await fs.readFile(path.join(target, "hello.txt"), "utf8"),
    "desktop roundtrip",
  );
  assert.equal(
    await fs.readFile(path.join(target, ".env"), "utf8"),
    "APP_SECRET=desktop-env-private-fixture\n",
  );
  assert.equal(
    await fs.readFile(path.join(target, "local-cache", "state.txt"), "utf8"),
    "ignored local state",
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
  // A metadata failure is a blocked install, never a successful zero-package
  // discovery. Use an actual authenticated malformed archive, not a UI stub.
  const badRoot = path.join(temp, "bad-metadata");
  await fs.mkdir(badRoot);
  await fs.writeFile(path.join(badRoot, "package.json"), '{"name":"fixture"}');
  await fs.mkdir(path.join(badRoot, "subproject"));
  await fs.writeFile(
    path.join(badRoot, "subproject", "package.json"),
    '{"name":"fixture", BROKEN_private-parser-value}',
  );
  execFileSync(
    process.execPath,
    [
      "apps/cli/main.ts",
      "capture",
      "--format",
      "2",
      "--root",
      badRoot,
      "--name",
      "bad-metadata",
      "--output",
      temp,
    ],
    {
      env: {
        ...process.env,
        DEVTELEPORT_PASSWORD: "desktop passphrase for testing",
      },
      stdio: "pipe",
    },
  );
  await page.locator('button[data-view="restore"]').click();
  await page.locator("#snapshot").fill(path.join(temp, "bad-metadata.dtp"));
  await page.locator("#target").fill(path.join(temp, "blocked-restore"));
  await page.locator('[data-action="restore"][data-dry="true"]').click();
  await page.waitForFunction(
    () =>
      document.getElementById("cancel").hidden &&
      document.getElementById("status").textContent === "Needs attention",
  );
  assert(await page.locator('[data-action="restore"].primary').isDisabled());
  const blockedGuide = await page.locator("#restoreSetup").textContent();
  assert(
    blockedGuide.includes("Invalid package.json: subproject/package.json"),
  );
  assert(!blockedGuide.includes("No supported Node.js packages were found"));
  assert(!blockedGuide.includes("will install these packages automatically"));
  assert(
    !(await page.locator("#consoleOutput").textContent()).includes(
      "private-parser-value",
    ),
  );
  assert(
    (await page.locator("#consoleOutput").textContent()).includes(
      "Needs attention",
    ),
  );
  assert(
    !(await page.locator("#consoleOutput").textContent()).includes(
      "Verification found differences",
    ),
  );
  assert(
    (await page.locator("#consoleOutput").textContent()).includes(
      "Archive reviewed. Dependency installation needs attention",
    ),
  );
  assert.equal(
    await page.locator("#consoleState").textContent(),
    "Needs attention",
  );
  assert(
    (await page.locator("#restoreReviewState").textContent()).includes(
      "needs attention",
    ),
  );
  await assert.rejects(fs.stat(path.join(temp, "blocked-restore")), {
    code: "ENOENT",
  });
  await fs.mkdir("dist/dependency-review", { recursive: true });
  await page.screenshot({
    path: "dist/dependency-review/blocked-install-review.png",
    fullPage: true,
  });
  await page.locator("#install").uncheck();
  await page.locator('[data-action="restore"][data-dry="true"]').click();
  await done();
  assert(!(await page.locator('[data-action="restore"].primary').isDisabled()));
  assert(
    (
      await page.locator('[data-action="restore"].primary').textContent()
    ).includes("Restore files"),
  );
  native.blockedDependencyReview = {
    actionDisabled: true,
    filesOnlyAvailable: true,
    diagnosticsPrivate: true,
  };
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
  await page.waitForFunction(
    () => document.getElementById("consoleState").textContent === "Cancelled",
  );
  assert(
    (await page.locator('#consoleSteps li[data-state="pending"]').count()) > 0,
  );
  await page.evaluate(() => {
    for (let i = 0; i < 650; i++) appendConsole("info", "Fixture event " + i);
    renderConsole();
  });
  assert.equal(await page.locator("#consoleOutput .console-line").count(), 500);
  assert(
    (await page.locator("#consoleCount").textContent()).includes(
      "older events omitted",
    ),
  );
  await page.locator("#consoleFollow").uncheck();
  await page.evaluate(() => {
    document.getElementById("consoleOutput").scrollTop = 0;
    appendConsole("info", "Fixture manual scroll preservation");
    renderConsole();
  });
  assert.equal(
    await page
      .locator("#consoleOutput")
      .evaluate((element) => element.scrollTop),
    0,
  );
  await page.locator("#consoleFollow").check();
  assert(
    await page
      .locator("#consoleOutput")
      .evaluate((element) => element.scrollTop > 0),
  );
  await page.locator("#consoleClear").click();
  assert.equal(await page.locator("#consoleState").textContent(), "Idle");
  assert(await page.locator("#consoleCopy").isDisabled());
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
  native.liveConsole = {
    liveInstallOutput: true,
    filteredCredentials: true,
    copyAndPrivateExport: true,
    noOverwriteExport: true,
    boundedTail: true,
    cancellationState: true,
  };
  native.includeIgnoredCapture = {
    optInDefaultOff: true,
    reviewInvalidation: true,
    environmentRestored: true,
    gitIgnoredDataRestored: true,
    environmentValuesHiddenInReview: true,
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
