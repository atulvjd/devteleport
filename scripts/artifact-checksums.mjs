import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version,
  files = [
    `dist/devteleport-${version}.tgz`,
    `apps/vscode-extension/devteleport-${version}.vsix`,
    ...(await fs.readdir("dist/desktop"))
      .filter(
        (name) =>
          name.startsWith(`DevTeleport-${version}-apple-silicon-unsigned.`) &&
          /\.(dmg|zip)$/.test(name),
      )
      .map((name) => path.join("dist/desktop", name)),
  ];
if (files.length !== 4)
  throw new Error(
    "Expected CLI, VSIX, ARM64 DMG and ARM64 ZIP; artifacts are missing or ambiguous",
  );
const lines = [];
for (const file of files) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  lines.push(hash.digest("hex") + "  " + file);
}
await fs.writeFile("dist/SHA256SUMS", lines.join("\n") + "\n");
console.log(lines.join("\n"));
