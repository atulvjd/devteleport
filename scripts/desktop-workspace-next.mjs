import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-next-ui-"));
let app;
try {
  const source = path.join(temp, "source"),
    target = path.join(temp, "restored");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "large.txt"), "test".repeat(200000));
  await fs.writeFile(
    path.join(source, "package.json"),
    JSON.stringify({
      name: "startup-fixture",
      scripts: { dev: "node server.cjs" },
    }),
  );
  await fs.writeFile(
    path.join(source, "server.cjs"),
    "require('node:fs').writeFileSync('server.pid',String(process.pid));const server=require('node:http').createServer((request,response)=>response.end('DevTeleport fixture running'));server.listen(0,'127.0.0.1',()=>{console.log('http://127.0.0.1:'+server.address().port+'/');console.log('my-fixture-private-value');});",
  );
  await fs.writeFile(
    path.join(source, ".env"),
    "MY_VALUE=my-fixture-private-value\n",
  );
  await fs.writeFile(
    path.join(source, ".env.local"),
    "EXCLUDE_ME=other-secret\n",
  );
  await fs.writeFile(
    path.join(source, ".env.example"),
    "MY_VALUE=\nMISSING_VALUE=\n",
  );
  const env = {
    ...process.env,
    DEVTELEPORT_USER_DATA: path.join(temp, "profile"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    ...(process.env.DEVTELEPORT_APP_BINARY
      ? { executablePath: process.env.DEVTELEPORT_APP_BINARY, args: [] }
      : { args: ["apps/desktop/main.cjs"] }),
    env,
  });
  console.log(
    "Test application state",
    await app.evaluate(({ app, BrowserWindow }) => ({
      ready: app.isReady(),
      windows: BrowserWindow.getAllWindows().length,
      packaged: app.isPackaged,
    })),
  );
  const page = await app.firstWindow({ timeout: 30000 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(
    (expected) =>
      document
        .getElementById("sideArchitecture")
        .textContent.includes(expected),
    version,
  );
  if (await page.locator("#welcome").isVisible())
    await page.locator("#welcomeDone").click();
  const done = async () => {
    await page.waitForFunction(
      () =>
        document.getElementById("cancel").hidden &&
        ["Completed", "Needs attention"].includes(
          document.getElementById("status").textContent,
        ),
    );
    assert.equal(
      await page.locator("#status").textContent(),
      "Completed",
      await page.locator("#result").textContent(),
    );
  };
  await page.locator("#source").fill(source);
  await page.locator('[data-view="capture"]').click();
  await page.locator("#name").fill("base");
  await page.locator("#output").fill(temp);
  await page.locator("#capturePassword").fill("desktop test long password");
  await page.locator("#reviewEnvironment").click();
  await done();
  await page.locator('[data-env-path=".env"]').check();
  await page.locator('[data-env-path=".env.example"]').check();
  assert(
    !(await page.locator("#environmentSelection").textContent()).includes(
      "my-fixture-private-value",
    ),
  );
  await page.locator('[data-action="capture"][data-dry]').click();
  await done();
  await page.locator('[data-action="capture"].primary').click();
  await done();
  await fs.writeFile(path.join(source, "change.txt"), "incremental change");
  await page.locator("#name").fill("delta");
  await page.locator("#captureBase").fill(path.join(temp, "base.dtp"));
  await page.locator('[data-action="capture"][data-dry]').click();
  await done();
  await page.locator('[data-action="capture"].primary').click();
  await done();
  assert((await fs.stat(path.join(temp, "delta.dtp"))).size < 10000);
  await fs.rm(source, { recursive: true });
  await page.locator('[data-view="restore"]').click();
  await page.locator("#snapshot").fill(path.join(temp, "delta.dtp"));
  await page.locator("#restoreBase").fill(path.join(temp, "base.dtp"));
  await page.locator("#target").fill(target);
  await page.locator("#restorePassword").fill("desktop test long password");
  await page.locator('[data-action="restore"][data-dry]').click();
  await done();
  assert(
    (await page.locator("#restoreReadinessPanel").textContent()).includes(
      "Restore readiness",
    ),
  );
  assert(
    (await page.locator("#restoreReadinessPanel").textContent()).includes(
      "MISSING_VALUE",
    ),
  );
  assert(
    !(await page.locator("#restoreReadinessPanel").textContent()).includes(
      "my-fixture-private-value",
    ),
  );
  await fs.mkdir("dist/evidence", { recursive: true });
  await page.screenshot({
    path: "dist/evidence/next-readiness.png",
    fullPage: true,
  });
  await page.locator('[data-action="restore"].primary').click();
  await done();
  await assert.rejects(fs.stat(path.join(target, ".env.local")));
  await page.locator("#reviewStartup").click();
  await done();
  await page.locator("#approveStartup").check();
  await page.locator("#runStartup").click();
  await page.waitForFunction(() =>
    document
      .getElementById("startupUrls")
      .textContent.includes("http://127.0.0.1:"),
  );
  assert(
    !(await page.locator("#consoleOutput").textContent()).includes(
      "my-fixture-private-value",
    ),
  );
  await page.screenshot({
    path: "dist/evidence/next-startup.png",
    fullPage: true,
  });
  const urlText = await page.locator("#startupUrls").textContent();
  const localUrl = urlText.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
  assert(localUrl);
  assert.equal(
    await (await fetch(localUrl)).text(),
    "DevTeleport fixture running",
  );
  const serverPid = Number(
    await fs.readFile(path.join(target, "server.pid"), "utf8"),
  );
  await page.locator("#cancel").click();
  await page.waitForFunction(() => document.getElementById("cancel").hidden);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.throws(
    () => process.kill(serverPid, 0),
    (error) => error.code === "ESRCH",
  );
  await page.locator('[data-view="comparison"]').click();
  await page.locator("#compareSnapshot").fill(path.join(temp, "delta.dtp"));
  await page.locator("#compareDirectory").fill(target);
  await page.locator("#compareBase").fill(path.join(temp, "base.dtp"));
  await page.locator("#comparePassword").fill("desktop test long password");
  await fs.writeFile(path.join(target, "change.txt"), "changed after restore");
  await page.locator("#compareWorkspace").click();
  await done();
  assert(
    (await page.locator("#comparisonResult").textContent()).includes(
      "change.txt",
    ),
  );
  await page.screenshot({
    path: "dist/evidence/next-comparison.png",
    fullPage: true,
  });
  for (const theme of ["dark", "light"]) {
    await page.locator('[data-view="settings"]').click();
    await page.locator("#theme").selectOption(theme);
    await page.waitForFunction(
      (expected) => document.documentElement.dataset.theme === expected,
      theme,
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(860, 650),
    );
    await page.locator('[data-view="comparison"]').click();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `dist/evidence/next-comparison-${theme}-compact.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "dist/evidence/workspace-next.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        passed: true,
        packaged: Boolean(process.env.DEVTELEPORT_APP_BINARY),
        checks: [
          "environment selection and hidden values",
          "incremental capture and source-removal restore",
          "readiness and missing configuration",
          "explicit startup approval",
          "live filtered logs and local URL",
          "cancellation terminates project process",
          "workspace comparison",
          "dark/light compact layouts",
          "zero renderer errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS desktop env selection, incremental capture/restore after source removal, readiness, approved startup/log filtering/local URL/cancellation, comparison",
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
