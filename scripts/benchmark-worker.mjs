import { pathToFileURL } from "node:url";
const { capture, restore } = await import(
  pathToFileURL(
    new URL("../dist/backend/packages/core/index.js", import.meta.url).pathname,
  ).href
);
const { hashFile } = await import(
  pathToFileURL(
    new URL("../dist/backend/packages/core/stream-v2.js", import.meta.url)
      .pathname,
  ).href
);
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import crypto from "node:crypto";
const [action, source, target] = process.argv.slice(2),
  start = performance.now();
let result;
if (action === "capture")
  result = await capture({
    root: source,
    name: "benchmark",
    output: target,
    password: "benchmark fixture passphrase",
    format: 2,
  });
else if (action === "restore")
  result = await restore(source, {
    target,
    password: "benchmark fixture passphrase",
  });
else if (action === "hash") result = { sha256: await hashFile(source) };
else if (action === "encrypt") {
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    crypto.randomBytes(32),
    crypto.randomBytes(12),
  );
  await pipeline(
    createReadStream(source, { highWaterMark: 256 * 1024 }),
    cipher,
    createWriteStream(target),
  );
  result = { bytes: (await fs.stat(target)).size };
} else if (action === "copy") {
  await pipeline(
    createReadStream(source, { highWaterMark: 256 * 1024 }),
    createWriteStream(target),
  );
  result = { bytes: (await fs.stat(target)).size };
} else throw new Error("Unknown benchmark stage");
console.log(
  JSON.stringify({
    action,
    milliseconds: performance.now() - start,
    peakRssKiB: process.resourceUsage().maxRSS,
    currentRssBytes: process.memoryUsage().rss,
    architecture: process.arch,
    result,
  }),
);
