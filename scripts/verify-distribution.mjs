import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const file = path.resolve(
  process.env.DEVTELEPORT_DMG ||
    `dist/desktop/DevTeleport-${version}-apple-silicon-unsigned.dmg`,
);
const checks = [];
const mount = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-distribution-"));
let attached = false;
try {
  execFileSync("/usr/bin/hdiutil", ["verify", file], { stdio: "pipe" });
  checks.push({ name: "dmg-checksum", status: "PASS" });
  execFileSync(
    "/usr/bin/hdiutil",
    ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, file],
    { stdio: "pipe" },
  );
  attached = true;
  const app = path.join(mount, "DevTeleport.app");
  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", app],
    { stdio: "pipe" },
  );
  checks.push({ name: "actual-dmg-app-signature-integrity", status: "PASS" });
  const bundleId = execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleIdentifier", path.join(app, "Contents/Info.plist")],
    { encoding: "utf8" },
  ).trim();
  if (bundleId !== "dev.devteleport.desktop")
    throw new Error("Unexpected distributed bundle identifier");
  checks.push({
    name: "distributed-bundle-identifier",
    status: "PASS",
    detail: bundleId,
  });
} catch (error) {
  checks.push({
    name: "distribution-integrity",
    status: "FAIL",
    detail: error.stderr?.toString() || error.message,
  });
} finally {
  if (attached) {
    try {
      execFileSync("/usr/bin/hdiutil", ["detach", mount], { stdio: "pipe" });
      attached = false;
    } catch (error) {
      checks.push({
        name: "detach-test-image",
        status: "FAIL",
        detail: error.message,
      });
    }
  }
  if (!attached) await fs.rmdir(mount);
}
const hash = crypto.createHash("sha256");
for await (const chunk of createReadStream(file)) hash.update(chunk);
const report = {
  createdAt: new Date().toISOString(),
  file,
  sha256: hash.digest("hex"),
  checks,
  ok: checks.length >= 3 && checks.every((check) => check.status === "PASS"),
  trust:
    "Code/resource integrity only. A valid ad-hoc seal is not Developer ID trust, Gatekeeper approval, or notarization. Downloaded installations still require real acceptance testing.",
};
await fs.mkdir("dist/evidence", { recursive: true });
await fs.writeFile(
  "dist/evidence/distribution.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
