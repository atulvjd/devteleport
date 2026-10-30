import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-desktop-benchmark-"));
let app;
try {
  const source = path.join(temp, "source");
  await fs.mkdir(source);
  const file = await fs.open(path.join(source, "large.bin"), "wx"),
    block = crypto.randomBytes(1024 * 1024);
  for (let i = 0; i < 256; i++) await file.write(block);
  await file.close();
  const env = {
    ...process.env,
    DEVTELEPORT_USER_DATA: path.join(temp, "profile"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const started = performance.now();
  app = await electron.launch({
    ...(process.env.DEVTELEPORT_APP_BINARY
      ? { executablePath: process.env.DEVTELEPORT_APP_BINARY, args: [] }
      : { args: ["apps/desktop/main.cjs"] }),
    env,
  });
  const page = await app.firstWindow();
  await page.locator("#welcomeDone").waitFor({ state: "visible" });
  const startupMilliseconds = performance.now() - started;
  await page.locator("#welcomeDone").click();
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const idle = await app.evaluate(({ app }) =>
    app
      .getAppMetrics()
      .map((p) => ({ type: p.type, memory: p.memory, cpu: p.cpu })),
  );
  let peakWorkingSetKiB = 0,
    sampling = false;
  const timer = setInterval(async () => {
    if (sampling) return;
    sampling = true;
    try {
      const total = await app.evaluate(({ app }) =>
        app
          .getAppMetrics()
          .reduce((sum, p) => sum + p.memory.workingSetSize, 0),
      );
      peakWorkingSetKiB = Math.max(peakWorkingSetKiB, total);
    } catch {
    } finally {
      sampling = false;
    }
  }, 250);
  const captureStarted = performance.now();
  const capturePromise = page.evaluate(
    (input) => window.teleport.operation(input),
    {
      action: "capture",
      source,
      name: "desktop-bench",
      output: temp,
      password: "desktop benchmark passphrase",
      toolDirectories: "",
    },
  );
  const frames = [];
  for (let i = 0; i < 10; i++) {
    frames.push(
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const start = performance.now();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now() - start)),
            );
          }),
      ),
    );
  }
  const capture = await capturePromise;
  clearInterval(timer);
  const report = {
    createdAt: new Date().toISOString(),
    architecture: await app.evaluate(() => process.arch),
    host: { cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem() },
    startupMilliseconds,
    idleProcesses: idle,
    peakAggregateWorkingSetKiB: peakWorkingSetKiB,
    captureMilliseconds: performance.now() - captureStarted,
    fixtureBytes: 256 * 1024 * 1024,
    rendererTwoFrameLatencyMs: frames,
    capture: {
      formatVersion: capture.formatVersion,
      fileCount: capture.fileCount,
    },
    notes: [
      "Fresh application process and profile; OS caches not cleared.",
      "Working sets are summed across Electron processes and can double-count shared pages. Sampling only during capture at 250 ms.",
      "Renderer frame timing is an observation under this fixture, not a user-interaction latency guarantee.",
    ],
  };
  await fs.mkdir("dist/evidence", { recursive: true });
  await fs.writeFile(
    "dist/evidence/desktop-performance.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (app) await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
