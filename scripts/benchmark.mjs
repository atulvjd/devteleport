import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-benchmark-"));
try {
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  const file = path.join(root, "large.bin"),
    handle = await fs.open(file, "wx"),
    block = crypto.randomBytes(1024 * 1024),
    mebibytes = Number(process.env.DEVTELEPORT_BENCH_MIB || 256);
  if (!Number.isInteger(mebibytes) || mebibytes < 1 || mebibytes > 8192)
    throw new Error("Benchmark size must be 1–8192 MiB");
  for (let i = 0; i < mebibytes; i++) await handle.write(block);
  await handle.close();
  const run = (action, source, target) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["scripts/benchmark-worker.mjs", action, source, target ?? ""],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      ),
    );
  const hash = run("hash", file),
    copy = run("copy", file, path.join(temp, "copy")),
    encryption = run("encrypt", file, path.join(temp, "encrypted")),
    capture = run("capture", root, temp);
  await fs.rm(root, { recursive: true });
  const restore = run(
    "restore",
    capture.result.output,
    path.join(temp, "independent"),
  );
  const restoredHash = run(
    "hash",
    path.join(restore.result.target, "large.bin"),
  );
  if (hash.result.sha256 !== restoredHash.result.sha256)
    throw new Error("Benchmark content mismatch");
  const report = {
    createdAt: new Date().toISOString(),
    host: {
      os: process.platform,
      architecture: process.arch,
      cpu: os.cpus()[0]?.model,
      memoryBytes: os.totalmem(),
      node: process.versions.node,
    },
    fixture: {
      bytes: mebibytes * 1024 * 1024,
      description:
        "Repeated random 1 MiB block, uncompressed format 2; original removed before restore",
    },
    stages: [hash, copy, encryption, capture, restore].map((stage) => ({
      ...stage,
      mebibytesPerSecond: mebibytes / (stage.milliseconds / 1000),
      result: undefined,
    })),
    notes: [
      "Each stage runs in a fresh Node process using the compiled production backend (no TypeScript loader). maxRSS is reported by process.resourceUsage in KiB.",
      "Encryption-only excludes KDF/metadata/source staging. Copy/encrypt comparison is an observation, not an isolated encryption-overhead guarantee.",
      "OS disk caches were not cleared; this is not a physical two-device or device-family benchmark.",
    ],
  };
  await fs.mkdir("dist/evidence", { recursive: true });
  await fs.writeFile(
    "dist/evidence/performance.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
