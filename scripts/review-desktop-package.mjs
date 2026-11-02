import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { listPackage, extractFile } from "@electron/asar";
import { stripTypeScriptTypes } from "node:module";

const root = path.resolve(
  process.env.DEVTELEPORT_APP_BUNDLE ||
    "dist/desktop/mac-arm64/DevTeleport.app",
);
const asar = path.join(root, "Contents/Resources/app.asar");
const files = listPackage(asar);
for (const file of files)
  assert(
    file === "/apps" ||
      file === "/apps/desktop" ||
      file.startsWith("/apps/desktop/") ||
      ["/package.json", "/LICENSE"].includes(file),
    "Unexpected desktop package path: " + file,
  );
for (const file of [
  "/apps/desktop/main.cjs",
  "/apps/desktop/preload.cjs",
  "/apps/desktop/renderer.js",
  "/apps/desktop/index.html",
  "/LICENSE",
  "/package.json",
])
  assert(files.includes(file), "Missing desktop file: " + file);
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
assert.equal(
  JSON.parse(extractFile(asar, "package.json").toString()).version,
  version,
);
const backend = path.join(root, "Contents/Resources/backend");
const backendFiles = [];
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else
      backendFiles.push(path.relative(backend, file).split(path.sep).join("/"));
  }
}
await walk(backend);
for (const file of backendFiles)
  assert(
    ["entry.cjs", "package.json", "build-info.json"].includes(file) ||
      /^(apps\/cli\/main|packages\/core\/[a-z0-9-]+)\.js$/.test(file),
    "Unexpected backend file: " + file,
  );
const matchedSource = [];
for (const file of backendFiles.filter((file) =>
  /^(apps\/cli\/main|packages\/core\/[a-z0-9-]+)\.js$/.test(file),
)) {
  const source = file.replace(/\.js$/, ".ts");
  const expected = stripTypeScriptTypes(
    await fs.readFile(source, "utf8"),
  ).replace(/\.ts(?=["'])/g, ".js");
  assert.equal(
    await fs.readFile(path.join(backend, file), "utf8"),
    expected,
    "Stale backend source: " + source,
  );
  matchedSource.push(source);
}
for (const file of files.filter(
  (file) => file.startsWith("/apps/desktop/") && /\.[a-z]+$/.test(file),
)) {
  assert.deepEqual(
    extractFile(asar, file.slice(1)),
    await fs.readFile(file.slice(1)),
    "Stale desktop source: " + file,
  );
  matchedSource.push(file.slice(1));
}
const report = {
  at: new Date().toISOString(),
  version,
  bundle: root,
  uiFiles: files,
  backendFiles,
  internalDocsExcluded: true,
  buildDependenciesExcluded: true,
  userDataExcluded: true,
  matchedSource,
  ok: true,
};
await fs.mkdir("dist/evidence", { recursive: true });
await fs.writeFile(
  "dist/evidence/desktop-package-review.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
