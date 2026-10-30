import { spawnSync } from "node:child_process";
const identity = process.env.CSC_LINK || process.env.CSC_NAME;
const apple =
  Boolean(
    process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER,
  ) ||
  Boolean(
    process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID,
  );
if (!identity || !apple) {
  console.error(
    "BLOCKED: Developer ID signing identity and authorized Apple notarization credentials are required. No signing, notarization or upload was attempted.",
  );
  process.exitCode = 2;
} else {
  const result = spawnSync(
    "npm",
    [
      "run",
      "package:desktop",
      "--",
      "--publish",
      "never",
      "--config.mac.hardenedRuntime=true",
      "--config.mac.notarize=true",
      "--config.mac.entitlements=apps/desktop/entitlements.mac.plist",
      "--config.mac.entitlementsInherit=apps/desktop/entitlements.mac.plist",
      "--config.artifactName=DevTeleport-${version}-apple-silicon.${ext}",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DEVTELEPORT_SIGNED_BUILD: "1",
        CSC_IDENTITY_AUTO_DISCOVERY: "true",
      },
    },
  );
  process.exitCode = result.status ?? 1;
}
