import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

// A real, offline restore/install failure followed by an in-place desktop retry.
// Never points at a user's project or the normal desktop profile.
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-setup-retry-"));
const output = path.resolve("dist/setup-retry");
const profile = path.join(temp, "profile");
const source = path.join(temp, "source");
const target = path.join(temp, "restored");
const failFlag = path.join(temp, "fail-api");
const holdFlag = path.join(temp, "hold-root");
const childPid = path.join(temp, "installer-child.pid");
const checks = [];
const rendererErrors = [];
const passphrase = "desktop setup retry fixture passphrase";
let app, page;
await fs.mkdir(output, { recursive: true });
await fs.mkdir("dist/evidence", { recursive: true });

async function count(directory) {
  return Number(
    await fs.readFile(
      path.join(target, directory, "install-count.txt"),
      "utf8",
    ),
  );
}
function record(name, detail = {}) {
  checks.push({ name, status: "PASS", ...detail });
  console.log("PASS " + name);
}
async function launch() {
  const env = { ...process.env, DEVTELEPORT_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    ...(process.env.DEVTELEPORT_APP_BINARY
      ? { executablePath: process.env.DEVTELEPORT_APP_BINARY, args: [] }
      : { args: ["apps/desktop/main.cjs"] }),
    env,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForSelector("#source");
  await page.waitForFunction(
    () =>
      document.getElementById("architecture").textContent !==
      "Checking runtime…",
  );
  if (await page.locator("#welcome").isVisible())
    await page.locator("#welcomeDone").click();
}
async function finish(expected = "Completed") {
  await page.waitForFunction(
    () =>
      document.getElementById("cancel").hidden &&
      ["Completed", "Needs attention"].includes(
        document.getElementById("status").textContent,
      ),
  );
  assert.equal(
    await page.locator("#status").textContent(),
    expected,
    await page.locator("#result").textContent(),
  );
}
function selection(directory) {
  return page.locator(
    `[data-setup-select][data-setup-directory=${JSON.stringify(directory)}]`,
  );
}
async function status(directory) {
  return (
    await page
      .locator(
        `[data-setup-status][data-setup-directory=${JSON.stringify(directory)}]`,
      )
      .textContent()
  ).trim();
}
async function review() {
  await page.locator("#reviewSetup").click();
  await finish();
  assert(
    !(await page.locator("#approveSetup").isChecked()),
    "Each review must require fresh explicit approval",
  );
  assert(await page.locator("#runSetup").isDisabled());
}
async function approveAndRun(expected = "Completed") {
  await page.locator("#approveSetup").check();
  assert(!(await page.locator("#runSetup").isDisabled()));
  await page.locator("#runSetup").click();
  await finish(expected);
}
async function snapshotsOfPanel(stage) {
  for (const theme of ["dark", "light"]) {
    await page.locator('button[data-view="settings"]').click();
    await page.locator("#theme").selectOption(theme);
    await page.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      theme,
    );
    for (const width of [1140, 800]) {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setBounds({ width, height: 820 }),
        width,
      );
      await page.locator('button[data-view="restore"]').click();
      await page.locator("#setupRecovery").scrollIntoViewIfNeeded();
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(
        layout.scroll <= layout.width + 1,
        `${stage} ${theme} ${width}: horizontal overflow`,
      );
      await page.locator("#setupRecovery").screenshot({
        path: path.join(output, `${stage}-${theme}-${width}.png`),
        animations: "disabled",
      });
      record("retry panel layout", { stage, theme, width: layout.width });
    }
  }
}

try {
  await fs.mkdir(path.join(source, "api"), { recursive: true });
  await fs.writeFile(
    path.join(source, "README.md"),
    "Saved source must survive failed installs, stale review and cancellation.\n",
  );
  await fs.writeFile(failFlag, "fail once");
  for (const directory of [".", "api"]) {
    await fs.writeFile(
      path.join(source, directory, "package.json"),
      JSON.stringify({
        name: directory === "." ? "orbit-web" : "orbit-api",
        version: "1.0.0",
        private: true,
        scripts: { postinstall: "node install.cjs", dev: "node app.cjs" },
      }),
    );
    const fixture = [
      "const fs=require('node:fs');",
      "const counter='install-count.txt';fs.writeFileSync(counter,String((fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8')):0)+1));",
      directory === "api"
        ? `if(fs.existsSync(${JSON.stringify(failFlag)})){console.error('API_TOKEN=private-retry-fixture');process.exit(1);}`
        : `if(fs.existsSync(${JSON.stringify(holdFlag)})){const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(childPid)},String(child.pid));setInterval(()=>{},1000);}else`,
      "{fs.writeFileSync('dependencies-ready.txt','ready');console.log('Fixture package installed');}",
    ].join("\n");
    await fs.writeFile(path.join(source, directory, "install.cjs"), fixture);
    await fs.writeFile(
      path.join(source, directory, "app.cjs"),
      "if(require('node:fs').readFileSync('dependencies-ready.txt','utf8')!=='ready')process.exit(1);console.log('started');\n",
    );
  }
  await launch();
  await page.locator("#source").fill(source);
  await page.locator('[data-action="inspect"]').click();
  await finish();
  await page.locator('button[data-view="capture"]').click();
  await page.locator("#name").fill("retry-fixture");
  await page.locator("#output").fill(temp);
  await page.locator("#capturePassword").fill(passphrase);
  await page.locator('[data-action="capture"][data-dry="true"]').click();
  await finish();
  await page.locator('[data-action="capture"].primary').click();
  await finish();
  const archive = path.join(temp, "retry-fixture.dtp");
  await fs.rm(source, { recursive: true });
  await page.locator('button[data-view="restore"]').click();
  await page.locator("#snapshot").fill(archive);
  await page.locator("#target").fill(target);
  await page.locator("#restorePassword").fill(passphrase);
  await page.locator("#install").check();
  await page.locator('[data-action="restore"][data-dry="true"]').click();
  await finish();
  await page.locator('[data-action="restore"].primary').click();
  await finish("Needs attention");
  assert(await page.locator("#setupRecovery").isVisible());
  assert(
    (
      (await page.locator("#setupRetryTarget").textContent()) ||
      (await page.locator("#setupRetryTarget").inputValue())
    ).includes(target),
  );
  assert.match(await status("."), /installed|succeeded/i);
  assert.match(await status("api"), /failed/i);
  assert.equal(await count("."), 1);
  assert.equal(await count("api"), 1);
  const savedSource = await fs.readFile(path.join(target, "README.md"), "utf8");
  assert(
    !(
      (await page.locator("#result").textContent()) +
      (await page.locator("#consoleOutput").textContent())
    ).includes("private-retry-fixture"),
  );
  record(
    "partial failure shows successful and failed packages while preserving source",
  );
  await snapshotsOfPanel("failed");

  await app.close();
  app = null;
  await fs.unlink(archive);
  await launch();
  await page.locator('button[data-view="restore"]').click();
  assert(await page.locator("#setupRecovery").isVisible());
  assert.match(await status("."), /installed|succeeded/i);
  assert.match(await status("api"), /failed/i);
  assert(!(await selection(".").isChecked()));
  assert(await selection("api").isChecked());
  const bypass = await page.evaluate(async (source) => {
    try {
      await window.teleport.operation({
        action: "setup",
        source,
        install: true,
        approveExecution: true,
        installDirectories: ["api"],
      });
      return "unexpected success";
    } catch (error) {
      return error.message;
    }
  }, target);
  assert.match(bypass, /review|approval/i);
  assert.equal(await count("api"), 1);
  record(
    "retry state survives relaunch and execution without reviewed approval is refused",
  );

  await review();
  assert.equal(await count("."), 1);
  assert.equal(await count("api"), 1);
  record("retry review is read-only and only failed packages are selected");
  const apiManifest = path.join(target, "api/package.json");
  const manifest = JSON.parse(await fs.readFile(apiManifest, "utf8"));
  await fs.writeFile(
    apiManifest,
    JSON.stringify({ ...manifest, description: "changed after review" }),
  );
  await approveAndRun("Needs attention");
  assert.equal(await count("api"), 1);
  assert.match(await page.locator("#result").textContent(), /changed|review/i);
  record("changed metadata refuses stale execution before installer runs");

  await review();
  await page.locator("#approveSetup").check();
  await page.locator('button[data-view="settings"]').click();
  const oldDirectories = await page.locator("#toolDirectories").inputValue();
  await page.locator("#toolDirectories").fill(oldDirectories + "\n" + temp);
  await page.locator('button[data-view="restore"]').click();
  assert(!(await page.locator("#approveSetup").isChecked()));
  assert(await page.locator("#runSetup").isDisabled());
  record("tool-directory changes invalidate retry approval");
  await fs.unlink(failFlag);
  await review();
  await approveAndRun();
  assert.equal(
    await count("."),
    1,
    "Earlier successful install must not run again during selected retry",
  );
  assert.equal(await count("api"), 2);
  assert.equal(
    await fs.readFile(path.join(target, "api/dependencies-ready.txt"), "utf8"),
    "ready",
  );
  assert.equal(
    await fs.readFile(path.join(target, "README.md"), "utf8"),
    savedSource,
  );
  assert.match(await status("."), /installed|succeeded/i);
  assert.match(await status("api"), /installed|succeeded/i);
  record(
    "approved selected retry succeeds in the same restored directory without its source or snapshot",
  );
  await snapshotsOfPanel("installed");

  // Cancel a deliberate reinstall without turning that into a restore/re-copy.
  await fs.writeFile(holdFlag, "hold installer");
  await selection(".").check();
  await selection("api").uncheck();
  await review();
  await page.locator("#approveSetup").check();
  await page.locator("#runSetup").click();
  const deadline = Date.now() + 15000;
  let pid;
  while (Date.now() < deadline) {
    try {
      pid = Number(await fs.readFile(childPid, "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(pid > 0, "Installer lifecycle descendant must have started");
  await page.locator("#cancel").click();
  await finish("Needs attention");
  let descendantStopped = false;
  const stopDeadline = Date.now() + 3000;
  while (Date.now() < stopDeadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") {
        descendantStopped = true;
        break;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(descendantStopped, "Cancellation must stop the lifecycle descendant");
  assert.equal(
    await fs.readFile(path.join(target, "README.md"), "utf8"),
    savedSource,
  );
  assert.match(await status("."), /cancelled|interrupted/i);
  record(
    "cancelling retry terminates installer descendants and preserves restored source",
  );
  assert.deepEqual(rendererErrors, []);
  const settings = await fs.readFile(
    path.join(profile, "workspace-settings.json"),
    "utf8",
  );
  assert(!settings.includes(passphrase));
  await fs.writeFile(
    "dist/evidence/desktop-setup-retry.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        fixture:
          "Disposable offline Node projects; source removed, snapshot removed before retry; real npm lifecycle scripts.",
        packaged: Boolean(process.env.DEVTELEPORT_APP_BINARY),
        checks,
        rendererErrors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: Desktop dependency retry, partial status, approval guards, restart, stale review, cancellation and layouts.",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
