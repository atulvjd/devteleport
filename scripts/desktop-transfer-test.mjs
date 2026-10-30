import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { capture } from "../packages/core/index.ts";
import { hashFile } from "../packages/core/stream-v2.ts";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-two-apps-")),
  apps = [];
try {
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "work.txt"), "independent GUI transfer");
  const password = "two app transfer test password",
    a = await capture({
      root,
      name: "send",
      output: temp,
      password,
      format: 2,
    });
  await fs.rm(root, { recursive: true });
  async function launch(id) {
    const env = { ...process.env, DEVTELEPORT_USER_DATA: path.join(temp, id) };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({ args: ["apps/desktop/main.cjs"], env });
    apps.push(app);
    const page = await app.firstWindow();
    await page.locator("#welcomeDone").click();
    await page.locator('[data-view="transfer"]').click();
    return page;
  }
  const receiving = await launch("receiver-profile"),
    sending = await launch("sender-profile"),
    target = path.join(temp, "received.dtp"),
    pair = path.join(temp, "pairing.json");
  await receiving.locator("#receiveTarget").fill(target);
  await receiving.locator("#pairingOutput").fill(pair);
  await receiving.locator("#approveReceive").check();
  await receiving.locator("#receiveButton").click();
  await receiving.waitForFunction(() =>
    document.getElementById("transferInfo").textContent.includes("fingerprint"),
  );
  await sending.locator("#sendSnapshot").fill(a.output);
  await sending.locator("#pairing").fill(pair);
  await sending.locator("#pairingInfo").click();
  await sending.waitForFunction(
    () => document.getElementById("status").textContent === "Completed",
  );
  assert(
    (await sending.locator("#transferInfo").textContent()).includes(
      "fingerprint",
    ),
  );
  await sending.locator("#sendPassword").fill(password);
  await sending.locator("#approvePeer").check();
  await sending.locator("#sendButton").click();
  await sending.waitForFunction(() =>
    ["Completed", "Needs attention"].includes(
      document.getElementById("status").textContent,
    ),
  );
  assert.equal(
    await sending.locator("#status").textContent(),
    "Completed",
    await sending.locator("#result").textContent(),
  );
  await receiving.waitForFunction(
    () => document.getElementById("status").textContent === "Completed",
  );
  assert.equal(await hashFile(target), await hashFile(a.output));
  await receiving.locator('[data-view="restore"]').click();
  await receiving.locator("#target").fill(path.join(temp, "independent"));
  await receiving.locator("#restorePassword").fill(password);
  await receiving.locator('[data-action="restore"][data-dry="true"]').click();
  await receiving.waitForFunction(
    () => document.getElementById("status").textContent === "Completed",
  );
  await receiving.locator('[data-action="restore"].primary').click();
  await receiving.waitForFunction(() =>
    ["Completed", "Needs attention"].includes(
      document.getElementById("status").textContent,
    ),
  );
  assert.equal(
    await receiving.locator("#status").textContent(),
    "Completed",
    await receiving.locator("#result").textContent(),
  );
  assert.equal(
    await fs.readFile(path.join(temp, "independent", "work.txt"), "utf8"),
    "independent GUI transfer",
  );
  console.log(
    "PASS: two real Electron instances paired, transferred over TLS, received and independently restored. Same-host test; no physical two-Mac claim.",
  );
} catch (error) {
  for (const app of apps) {
    try {
      for (const page of app.windows())
        console.error(
          await page.locator("#status").textContent(),
          await page.locator("#result").textContent(),
        );
    } catch {}
  }
  throw error;
} finally {
  for (const app of apps) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
