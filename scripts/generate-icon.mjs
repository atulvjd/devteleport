import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["scripts/icon-render.cjs"], env });
try {
  const page = await app.firstWindow();
  await page.waitForSelector("svg");
  await page.setViewportSize({ width: 1024, height: 1024 });
  await page.screenshot({ path: "assets/icon.png", omitBackground: true });
} finally {
  await app.close();
}
const icons = path.resolve("assets/DevTeleport.iconset");
await fs.mkdir(icons, { recursive: true });
for (const size of [16, 32, 128, 256, 512])
  for (const scale of [1, 2]) {
    const file = path.join(
      icons,
      `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
    );
    execFileSync(
      "/usr/bin/sips",
      [
        "-z",
        String(size * scale),
        String(size * scale),
        "assets/icon.png",
        "--out",
        file,
      ],
      { stdio: "pipe" },
    );
  }
execFileSync("/usr/bin/iconutil", [
  "-c",
  "icns",
  icons,
  "-o",
  "assets/DevTeleport.icns",
]);
console.log("Generated native macOS icon assets.");
