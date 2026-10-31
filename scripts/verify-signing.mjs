import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
const app = path.resolve(
    process.env.DEVTELEPORT_APP_BUNDLE ||
      "dist/desktop/mac-arm64/DevTeleport.app",
  ),
  checks = [];
for (const [name, tool, args] of [
  [
    "codesign",
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", app],
  ],
  [
    "Gatekeeper",
    "/usr/sbin/spctl",
    ["--assess", "--type", "execute", "--verbose=2", app],
  ],
  ["notarization-ticket", "/usr/bin/xcrun", ["stapler", "validate", app]],
]) {
  const r = spawnSync(tool, args, { encoding: "utf8" });
  checks.push({
    name,
    status: r.status === 0 ? "PASS" : "BLOCKED",
    detail: (r.stdout || "") + (r.stderr || ""),
  });
}
const identity = spawnSync("/usr/bin/codesign", ["-d", "--verbose=2", app], {
  encoding: "utf8",
});
const identityDetails = (identity.stdout || "") + (identity.stderr || "");
checks.push({
  name: "Developer-ID-identity",
  status:
    identity.status === 0 &&
    /^Authority=Developer ID Application:/m.test(identityDetails) &&
    /^TeamIdentifier=(?!not set$).+/m.test(identityDetails)
      ? "PASS"
      : "BLOCKED",
  detail: identityDetails,
});
await fs.mkdir("dist/evidence", { recursive: true });
await fs.writeFile(
  "dist/evidence/signing.json",
  JSON.stringify({ checks }, null, 2),
);
console.log(JSON.stringify(checks, null, 2));
if (checks.some((c) => c.status !== "PASS")) process.exitCode = 2;
