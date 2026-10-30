import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
export async function buildBackend(root = path.resolve("dist/backend")) {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  for (const directory of ["apps/cli", "packages/core"]) {
    await fs.mkdir(path.dirname(path.join(root, directory)), {
      recursive: true,
    });
    await fs.cp(directory, path.join(root, directory), { recursive: true });
  }
  async function convert(directory) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await convert(file);
      else if (file.endsWith(".ts")) {
        const data = stripTypeScriptTypes(
          await fs.readFile(file, "utf8"),
        ).replace(/\.ts(?=["'])/g, ".js");
        await fs.writeFile(file.slice(0, -3) + ".js", data, {
          mode: (await fs.stat(file)).mode & 0o777,
        });
        await fs.unlink(file);
      }
    }
  }
  await convert(path.join(root, "apps"));
  await convert(path.join(root, "packages"));
  await fs.writeFile(
    path.join(root, "entry.cjs"),
    `import('./apps/cli/main.js').then(()=>process.stdout.write('',()=>process.exit(process.exitCode||0))).catch(error=>{console.error('DevTeleport: '+error.message);process.exit(1);});`,
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  const inventory = {};
  async function hashTree(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await hashTree(file);
      else
        inventory[path.relative(root, file).split(path.sep).join("/")] = crypto
          .createHash("sha256")
          .update(await fs.readFile(file))
          .digest("hex");
    }
  }
  await hashTree(root);
  const ui = {};
  for (const name of await fs.readdir("apps/desktop"))
    if (/\.(cjs|js|css|html)$/.test(name)) {
      const relative = "apps/desktop/" + name;
      ui[relative] = crypto
        .createHash("sha256")
        .update(await fs.readFile(relative))
        .digest("hex");
    }

  await fs.writeFile(
    path.join(root, "build-info.json"),
    JSON.stringify(
      {
        formatVersion: 1,
        hostArchitecture: process.arch,
        files: inventory,
        ui,
        version: JSON.parse(await fs.readFile("package.json", "utf8")).version,
      },
      null,
      2,
    ),
  );
}
if (process.argv[1] === new URL(import.meta.url).pathname) await buildBackend();
