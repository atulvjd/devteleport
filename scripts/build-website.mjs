import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "apps/website");
const output = path.join(root, "dist/website");

// Keep deployment independent of Electron, native tools and npm dependencies.
const html = await readFile(path.join(source, "index.html"), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
if (new Set(ids).size !== ids.length) throw new Error("Duplicate HTML IDs");
for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) {
  if (!ids.includes(id)) throw new Error(`Broken internal link: #${id}`);
}
for (const [, asset] of html.matchAll(
  /(?:src|href)="((?:assets\/|style\.css|site\.js)[^"]*)"/g,
)) {
  await readFile(path.join(source, asset));
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ["index.html", "style.css", "site.js", "assets"]) {
  await cp(path.join(source, file), path.join(output, file), {
    recursive: true,
  });
}
const assets = await readdir(path.join(output, "assets"));
console.log(
  `Website built: dist/website (${assets.length} local assets; no dependencies)`,
);
