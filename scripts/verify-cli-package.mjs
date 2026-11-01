import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const archive = path.resolve(`dist/devteleport-${version}.tgz`);
const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
  .trim()
  .split("\n");
const allowed = new Set([
  "package/LICENSE",
  "package/README.md",
  "package/package.json",
  "package/docs/FORMAT-2.md",
  "package/docs/NETWORK-TRANSFER.md",
  "package/docs/SECURITY.md",
  "package/docs/TROUBLESHOOTING.md",
  "package/docs/INCLUDE-IGNORED.md",
]);
for (const file of files) {
  assert(
    allowed.has(file) ||
      /^package\/(apps\/cli\/main|packages\/core\/[a-z0-9-]+)\.js$/.test(file),
    `Unexpected public package file: ${file}`,
  );
}
for (const file of allowed)
  assert(files.includes(file), `Missing package file: ${file}`);
const read = (file) =>
  execFileSync("tar", ["-xOf", archive, file], { encoding: "utf8" });
const metadata = JSON.parse(read("package/package.json"));
assert.equal(metadata.name, "devteleport");
assert.equal(metadata.version, version);
assert.equal(metadata.bin.devteleport, "apps/cli/main.js");
assert.equal(metadata.private, undefined);
assert.equal(metadata.engines.node, ">=24");
assert.deepEqual(metadata.os, ["darwin", "linux"]);
assert.equal(Object.keys(metadata.dependencies || {}).length, 0);
assert.equal(Object.keys(metadata.devDependencies || {}).length, 0);
assert.equal(Object.keys(metadata.scripts || {}).length, 0);
assert(read("package/apps/cli/main.js").startsWith("#!/usr/bin/env node"));
for (const file of files.filter((file) => /\.(md|json)$/.test(file))) {
  assert(
    !/\/Users\/|ACCOUNT-HANDOFF|NEXT-SESSION-PROMPT|docs\/requirements\/|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(
      read(file),
    ),
    `Internal/private material in ${file}`,
  );
}
const readme = read("package/README.md");
for (const match of readme.matchAll(/\]\((docs\/[^)]+)\)/g))
  assert(
    files.includes("package/" + match[1]),
    `Broken packaged documentation link: ${match[1]}`,
  );
const report = {
  createdAt: new Date().toISOString(),
  package: metadata.name,
  version,
  archive,
  bytes: (await fs.stat(archive)).size,
  sha256: crypto
    .createHash("sha256")
    .update(await fs.readFile(archive))
    .digest("hex"),
  files,
  ok: true,
  policy:
    "Only compiled CLI/core, five selected user guides, public CLI README, metadata and MIT license. No internal reports, original prompts, desktop, node_modules, install scripts or credentials are allowed.",
};
await fs.mkdir("dist/evidence", { recursive: true });
await fs.writeFile(
  "dist/evidence/cli-publication-review.json",
  JSON.stringify(report, null, 2),
);
console.log(
  `PASS public CLI package: ${files.length} files, ${report.bytes} bytes, SHA-256 ${report.sha256}`,
);
