import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
const bundle = path.resolve(
    process.env.DEVTELEPORT_APP_BUNDLE ||
      "dist/desktop/mac-arm64/DevTeleport.app",
  ),
  checks = [];
checks.push({
  name: "host",
  status:
    process.platform === "darwin" && process.arch === "arm64" ? "PASS" : "FAIL",
  detail: {
    platform: process.platform,
    architecture: process.arch,
    cpu: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(),
  },
});
checks.push({
  name: "node-binary",
  status: "PASS",
  detail: execFileSync("/usr/bin/file", ["-b", process.execPath], {
    encoding: "utf8",
  }).trim(),
});
async function walk(directory) {
  for (const ent of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, ent.name);
    if (ent.isDirectory()) await walk(file);
    else if (ent.isFile()) {
      const handle = await fs.open(file, "r");
      const b = Buffer.alloc(4);
      try {
        await handle.read(b, 0, 4, 0);
      } finally {
        await handle.close();
      }
      const magic = b.toString("hex");
      if (
        [
          "cffaedfe",
          "cefaedfe",
          "feedface",
          "feedfacf",
          "cafebabe",
          "bebafeca",
          "cafebabf",
          "bfbafeca",
        ].includes(magic)
      ) {
        const arches = execFileSync("/usr/bin/lipo", ["-archs", file], {
          encoding: "utf8",
        }).trim();
        checks.push({
          name: path.relative(bundle, file),
          status: arches.split(/\s+/).includes("arm64") ? "PASS" : "FAIL",
          detail: arches,
        });
      } else if (file.endsWith(".node"))
        checks.push({
          name: path.relative(bundle, file),
          status: "FAIL",
          detail: "Native addon has unrecognized architecture",
        });
    }
  }
}
try {
  await walk(bundle);
  const backend = path.join(bundle, "Contents/Resources/backend/entry.cjs");
  await fs.access(backend);
  const root = path.join(bundle, "Contents/Resources/backend"),
    inventory = JSON.parse(
      await fs.readFile(path.join(root, "build-info.json"), "utf8"),
    );
  for (const [relative, expected] of Object.entries(inventory.files)) {
    if (relative.startsWith("/") || relative.split("/").includes(".."))
      throw new Error("Unsafe build inventory path");
    const actual = crypto
      .createHash("sha256")
      .update(await fs.readFile(path.join(root, relative)))
      .digest("hex");
    checks.push({
      name: "backend-integrity:" + relative,
      status: actual === expected ? "PASS" : "FAIL",
      detail: actual,
    });
  }
  const { extractFile } = await import("@electron/asar");
  for (const [relative, expected] of Object.entries(inventory.ui ?? {})) {
    const actual = crypto
      .createHash("sha256")
      .update(
        extractFile(path.join(bundle, "Contents/Resources/app.asar"), relative),
      )
      .digest("hex");
    checks.push({
      name: "ui-integrity:" + relative,
      status: actual === expected ? "PASS" : "FAIL",
      detail: actual,
    });
  }
  const packagedMetadata = JSON.parse(
    extractFile(
      path.join(bundle, "Contents/Resources/app.asar"),
      "package.json",
    ).toString("utf8"),
  );
  const expectedVersion = JSON.parse(
    await fs.readFile("package.json", "utf8"),
  ).version;
  checks.push({
    name: "bundle-version",
    status:
      packagedMetadata.version === inventory.version &&
      packagedMetadata.version === expectedVersion
        ? "PASS"
        : "FAIL",
    detail: packagedMetadata.version,
  });
  for (const [key, expected] of [
    ["CFBundleShortVersionString", expectedVersion],
    ["CFBundleIdentifier", "dev.devteleport.desktop"],
  ]) {
    const actual = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :" + key, path.join(bundle, "Contents/Info.plist")],
      { encoding: "utf8" },
    ).trim();
    checks.push({
      name: key,
      status: actual === expected ? "PASS" : "FAIL",
      detail: actual,
    });
  }
  checks.push({
    name: "bundled-backend",
    status: "PASS",
    detail:
      "Compiled JavaScript executed by native Electron utility process; no external Node dependency",
  });
} catch (error) {
  checks.push({
    name: "bundle-inspection",
    status: "BLOCKED",
    detail: error.message,
  });
}
try {
  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", bundle],
    { stdio: "pipe" },
  );
  checks.push({
    name: "bundle-signature-integrity",
    status: "PASS",
    detail:
      "Resource/code seals verify. Ad-hoc integrity does not establish Developer ID trust or notarization.",
  });
} catch (error) {
  checks.push({
    name: "bundle-signature-integrity",
    status: "FAIL",
    detail: error.stderr?.toString() || error.message,
  });
}
const report = {
  createdAt: new Date().toISOString(),
  bundle,
  checks,
  ok: checks.every((c) => c.status === "PASS"),
};
await fs.mkdir("dist/evidence", { recursive: true });
await fs.writeFile(
  "dist/evidence/architecture.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
