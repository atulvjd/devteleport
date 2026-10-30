import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
const project = JSON.parse(await fs.readFile("package.json", "utf8"));
const root = path.resolve("dist/cli");
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
for (const p of ["apps/cli", "packages/core", "docs"]) {
  await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true });
  await fs.cp(p, path.join(root, p), { recursive: true });
}
async function transpile(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await transpile(file);
    else if (file.endsWith(".ts")) {
      const source = await fs.readFile(file, "utf8");
      const javascript = stripTypeScriptTypes(source).replace(
        /\.ts(?=["'])/g,
        ".js",
      );
      await fs.writeFile(file.slice(0, -3) + ".js", javascript, {
        mode: (await fs.stat(file)).mode & 0o777,
      });
      await fs.unlink(file);
    }
  }
}
await transpile(path.join(root, "apps"));
await transpile(path.join(root, "packages"));
for (const p of ["README.md", "LICENSE"])
  await fs.copyFile(p, path.join(root, p));
await fs.writeFile(
  path.join(root, "package.json"),
  JSON.stringify(
    {
      name: "devteleport",
      version: project.version,
      type: "module",
      description: "Encrypted local-first development workspace snapshots",
      license: "MIT",
      engines: { node: ">=24" },
      bin: { devteleport: "apps/cli/main.js" },
    },
    null,
    2,
  ),
);
execFileSync(
  "npm",
  [
    "pack",
    "--pack-destination",
    "..",
    "--cache",
    path.resolve("dist/.npm-cache"),
  ],
  { cwd: root, stdio: "inherit" },
);
