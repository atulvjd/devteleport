import { spawnSync } from "node:child_process";
const env = { ...process.env };
if (env.DEVTELEPORT_SIGNED_BUILD !== "1") {
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  delete env.CSC_LINK;
  delete env.CSC_KEY_PASSWORD;
  delete env.CSC_NAME;
}
const build = spawnSync(process.execPath, ["scripts/build-backend.mjs"], {
  stdio: "inherit",
  env,
});
if (build.status !== 0) process.exit(build.status ?? 1);
const packageResult = spawnSync(
  process.execPath,
  [
    "node_modules/electron-builder/out/cli/cli.js",
    "--config",
    "apps/desktop/builder.json",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env },
);
process.exitCode = packageResult.status ?? 1;
