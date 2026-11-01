import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-visual-"));
const output = path.resolve("dist/ui-review");
await fs.mkdir(output, { recursive: true });
await fs.mkdir("dist/evidence", { recursive: true });
const checks = [];
let app;
try {
  const root = path.join(temp, "orbit-workspace");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "README.md"),
    "# Orbit workspace\nVisual acceptance fixture with real local files.\n",
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "orbit-workspace",
      private: true,
      scripts: { dev: "node server.js" },
    }),
  );
  await fs.writeFile(
    path.join(root, "server.js"),
    "// Saved work travels with you.\n",
  );
  await fs.mkdir(path.join(root, "cms"));
  await fs.writeFile(
    path.join(root, "cms", "package.json"),
    JSON.stringify({
      name: "orbit-cms",
      private: true,
      dependencies: { "@strapi/strapi": "^5.0.0" },
      scripts: { develop: "strapi develop" },
    }),
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
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#welcomeDone").click();
  async function finish() {
    await page.waitForFunction(() =>
      ["Completed", "Needs attention"].includes(
        document.getElementById("status").textContent,
      ),
    );
    assert.equal(
      await page.locator("#status").textContent(),
      "Completed",
      await page.locator("#result").textContent(),
    );
  }
  await page.locator("#source").fill(root);
  await page.locator('[data-action="inspect"]').click();
  await finish();
  await page.locator('[data-view="capture"]').click();
  assert(await page.locator("#includeDb").isDisabled());
  await page.locator("#name").fill("orbit-checkpoint");
  await page.locator("#output").fill(temp);
  await page.locator("#capturePassword").fill("visual acceptance passphrase");
  await page.locator('[data-action="capture"][data-dry="true"]').click();
  await finish();
  await page.screenshot({
    path: path.join(output, "capture-review.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.locator('[data-action="capture"].primary').click();
  await finish();
  await page.locator('[data-view="restore"]').click();
  await page.locator("#snapshot").fill(path.join(temp, "orbit-checkpoint.dtp"));
  await page.locator("#target").fill(path.join(temp, "orbit-restored"));
  await page.locator("#restorePassword").fill("visual acceptance passphrase");
  assert(await page.locator('[data-action="restore"].primary').isDisabled());
  await page.locator('[data-action="restore"][data-dry="true"]').click();
  await finish();
  await page.screenshot({
    path: path.join(output, "restore-review.png"),
    fullPage: true,
    animations: "disabled",
  });
  for (const theme of ["dark", "light"]) {
    await page.locator('[data-view="settings"]').click();
    await page.locator("#theme").selectOption(theme);
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.theme === theme,
      theme,
    );
    for (const [width, height] of [
      [1140, 820],
      [800, 600],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, bounds) =>
          BrowserWindow.getAllWindows()[0].setBounds(bounds),
        { width, height },
      );
      for (const view of [
        "dashboard",
        "workspace",
        "capture",
        "restore",
        "library",
        "transfer",
        "settings",
        "about",
      ]) {
        await page.locator(`[data-view="${view}"]`).click();
        await page.evaluate(() => window.scrollTo(0, 0));
        const layout = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          heading: document.getElementById("pageTitle").getBoundingClientRect()
            .top,
          selected: document.querySelector('nav button[aria-current="page"]')
            ?.dataset.view,
        }));
        assert(
          layout.scroll <= layout.width + 1,
          `${theme} ${width} ${view}: horizontal overflow ${layout.scroll}/${layout.width}`,
        );
        assert(layout.heading >= 0, "Heading must be visible at navigation");
        assert.equal(layout.selected, view);
        await page.screenshot({
          path: path.join(output, `${theme}-${width}-${view}.png`),
          fullPage: true,
          animations: "disabled",
        });
        checks.push({
          theme,
          width,
          height,
          view,
          status: "PASS",
          horizontalOverflow: false,
        });
      }
      console.log(
        `PASS visual layout ${theme} ${width}×${height}: all eight screens`,
      );
    }
  }
  // Both reveal controls are reversible; no passphrase is written to settings.
  await page.locator('[data-view="capture"]').click();
  await page.locator('[data-toggle-password="capturePassword"]').click();
  assert.equal(
    await page.locator("#capturePassword").getAttribute("type"),
    "text",
  );
  await page.locator('[data-toggle-password="capturePassword"]').click();
  assert.equal(
    await page.locator("#capturePassword").getAttribute("type"),
    "password",
  );
  assert.deepEqual(errors, []);
  const settings = await fs.readFile(
    path.join(temp, "profile/workspace-settings.json"),
    "utf8",
  );
  assert(!settings.includes("visual acceptance passphrase"));
  await fs.writeFile(
    "dist/evidence/ui-review.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        checks,
        rendererErrors: errors,
        fixture:
          "Generated disposable files captured through the real UI; no production mock data.",
        limits:
          "Automated layout/screenshots and functional smoke. Manual assistive-technology acceptance remains outstanding.",
      },
      null,
      2,
    ),
  );
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
