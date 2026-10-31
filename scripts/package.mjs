import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
const project = JSON.parse(await fs.readFile("package.json", "utf8"));
const root = path.resolve("dist/cli");
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
for (const p of ["apps/cli", "packages/core"]) {
  await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true });
  await fs.cp(p, path.join(root, p), {
    recursive: true,
    filter: async (source) => {
      const entry = await fs.lstat(source);
      return entry.isDirectory() || (entry.isFile() && source.endsWith(".ts"));
    },
  });
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
await fs.copyFile("LICENSE", path.join(root, "LICENSE"));
await fs.mkdir(path.join(root, "docs"), { recursive: true });
const userDocs = [
  "FORMAT-2.md",
  "NETWORK-TRANSFER.md",
  "SECURITY.md",
  "TROUBLESHOOTING.md",
];
for (const name of userDocs)
  await fs.copyFile(path.join("docs", name), path.join(root, "docs", name));
const readme = (await fs.readFile("docs/CLI.md", "utf8")).replace(
  /\]\((FORMAT-2|NETWORK-TRANSFER|SECURITY|TROUBLESHOOTING)\.md\)/g,
  "](docs/$1.md)",
);
await fs.writeFile(path.join(root, "README.md"), readme);
await fs.writeFile(
  path.join(root, "package.json"),
  JSON.stringify(
    {
      name: "devteleport",
      version: project.version,
      type: "module",
      description: "Encrypted local-first development workspace snapshots",
      license: "MIT",
      os: ["darwin", "linux"],
      repository: {
        type: "git",
        url: "git+https://github.com/atulvjd/devteleport.git",
      },
      homepage: "https://github.com/atulvjd/devteleport#readme",
      bugs: { url: "https://github.com/atulvjd/devteleport/issues" },
      keywords: [
        "cli",
        "workspace",
        "snapshot",
        "encrypted",
        "developer-tools",
      ],
      files: ["apps/cli/*.js", "packages/core/*.js", "docs/*.md"],
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org/",
      },
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

execFileSync(process.execPath, ["scripts/verify-cli-package.mjs"], {
  stdio: "inherit",
});
