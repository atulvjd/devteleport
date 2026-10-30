import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  capture,
  restore,
  verify,
  readSnapshot,
  safePath,
  validateManifest,
  inspect,
} from "../packages/core/index.ts";
const password = "correct horse battery staple";
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-test-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  return { temp, root };
}
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
test("independent Git restore preserves staged, unstaged, untracked, deleted and executable files", async (t) => {
  const { root, temp } = await fixture(t);
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  await fs.writeFile(path.join(root, "app.mjs"), "console.log('initial')\n");
  await fs.writeFile(path.join(root, "deleted"), "delete me");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  await fs.writeFile(path.join(root, "app.mjs"), "console.log('staged')\n");
  git(root, "add", "app.mjs");
  await fs.writeFile(
    path.join(root, "app.mjs"),
    "console.log('restored independently')\n",
  );
  await fs.unlink(path.join(root, "deleted"));
  await fs.writeFile(path.join(root, "untracked"), "new data");
  await fs.writeFile(path.join(root, "run.sh"), "#!/bin/sh\necho works\n", {
    mode: 0o755,
  });
  await fs.symlink("app.mjs", path.join(root, "link"));
  await fs.mkdir(path.join(root, "nested", "node_modules"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "nested", "node_modules", "secret"),
    "dependency",
  );
  await fs.writeFile(path.join(root, ".env"), "TOKEN=secret");
  const before = git(root, "status", "--porcelain")
    .split("\n")
    .filter((x) => !x.includes(".env") && !x.includes("nested/"))
    .join("\n");
  const staged = git(root, "diff", "--cached");
  const result = await capture({ root, name: "test", output: temp, password });
  const m = await readSnapshot(result.output, password);
  assert(m.omitted.includes(".env"));
  assert(!m.files.some((f) => f.path.includes("node_modules")));
  await fs.rm(root, { recursive: true });
  const target = path.join(temp, "destination");
  await restore(result.output, { target, password });
  assert.equal(
    execFileSync(process.execPath, ["app.mjs"], {
      cwd: target,
      encoding: "utf8",
    }).trim(),
    "restored independently",
  );
  // Internal verification metadata is deliberately local and untracked.
  const status = git(target, "status", "--porcelain")
    .split("\n")
    .filter((x) => !x.includes(".devteleport/"))
    .join("\n");
  assert.equal(status, before);
  assert.equal(git(target, "diff", "--cached"), staged);
  assert((await verify(target)).ok);
  await fs.writeFile(path.join(target, "untracked"), "tampered");
  assert(!(await verify(target)).ok);
});
test("wrong password, corruption, dry-run and no overwrite", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "hello");
  const a = await capture({ root, name: "safe", output: temp, password });
  await assert.rejects(readSnapshot(a.output, "wrong"), /authenticate/);
  const bytes = await fs.readFile(a.output);
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(path.join(temp, "corrupt.dtp"), bytes);
  await assert.rejects(
    readSnapshot(path.join(temp, "corrupt.dtp"), password),
    /authenticate/,
  );
  const target = path.join(temp, "target");
  await restore(a.output, { target, password, dryRun: true });
  await assert.rejects(fs.stat(target));
  await fs.mkdir(target);
  await assert.rejects(
    restore(a.output, { target, password }),
    /already exists/,
  );
  await assert.rejects(
    capture({ root, name: "safe", output: temp, password }),
    /already exists/,
  );
});
test("path and schema attacks rejected", () => {
  for (const p of ["../x", "/tmp/x", "C:/x", "a\\b", "a//b", "a/../b", "x\0y"])
    assert.throws(() => safePath(p));
  assert.throws(() => validateManifest({ formatVersion: 2 }));
  const base = {
    formatVersion: 1,
    name: "x",
    platform: { os: "darwin", architecture: "arm64" },
    databases: [],
    files: [],
  };
  assert.throws(() =>
    validateManifest({
      ...base,
      files: [
        { path: "link", type: "symlink", target: "../escape", mode: 0o777 },
      ],
    }),
  );
  assert.throws(() =>
    validateManifest({
      ...base,
      files: [
        { path: "a", type: "symlink", target: "b", mode: 0o777 },
        { path: "a/payload", type: "directory", mode: 0o755 },
      ],
    }),
  );
  assert.throws(() =>
    validateManifest({
      ...base,
      files: [
        { path: "A", type: "directory", mode: 0o755 },
        { path: "a", type: "directory", mode: 0o755 },
      ],
    }),
  );
});
test("escaping symlinks and unconfigured database fail safely", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.symlink("/etc/passwd", path.join(root, "outside"));
  await assert.rejects(capture({ root, dryRun: true }), /Unsafe symlink/);
  await fs.unlink(path.join(root, "outside"));
  await assert.rejects(
    capture({ root, name: "db", output: temp, password, includeDb: true }),
    /No databases/,
  );
});
test("unborn repository and runtime discovery", async (t) => {
  const { root, temp } = await fixture(t);
  git(root, "init", "-q");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: { dev: "node app.js" },
      engines: { node: ">=24" },
    }),
  );
  const report = await inspect(root);
  assert.equal(report.git.commit, null);
  assert.equal(report.runtime.scripts.dev, "node app.js");
  const a = await capture({ root, name: "unborn", output: temp, password });
  const target = path.join(temp, "restored");
  await restore(a.output, { target, password });
  assert.equal(
    git(target, "symbolic-ref", "--short", "HEAD"),
    report.git.branch,
  );
});
test("CLI actual lifecycle", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "hello"), "world");
  const cli = path.resolve("apps/cli/main.ts");
  const env = { ...process.env, DEVTELEPORT_PASSWORD: password };
  const call = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args], {
        cwd: root,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  assert.equal(call("inspect").root, await fs.realpath(root));
  const a = call("capture", "--name", "cli", "--output", temp);
  const target = path.join(temp, "cli-restored");
  call("restore", a.output, "--target", target);
  assert.equal(call("verify", target).ok, true);
});
test("ignored directories are excluded and explicit prefixes are honored", async (t) => {
  const { root, temp } = await fixture(t);
  git(root, "init", "-q");
  await fs.writeFile(path.join(root, ".gitignore"), "build/\n");
  await fs.mkdir(path.join(root, "build"));
  await fs.writeFile(path.join(root, "build", "artifact"), "not source");
  await fs.writeFile(path.join(root, "excluded"), "explicit");
  await fs.writeFile(
    path.join(root, "devteleport.json"),
    JSON.stringify({ exclude: ["excluded"] }),
  );
  const a = await capture({ root, name: "ignore", output: temp, password });
  const m = await readSnapshot(a.output, password);
  assert(!m.files.some((f) => f.path === "build" || f.path === "excluded"));
  assert(m.omitted.includes("build"));
  assert(m.omitted.includes("excluded"));
});
test("checksum corruption, malformed base64 and reserved metadata rejected", () => {
  const base = {
    formatVersion: 1,
    name: "x",
    platform: { os: "darwin", architecture: "arm64" },
    databases: [],
  };
  for (const file of [
    {
      path: "a",
      type: "file",
      mode: 0o600,
      size: 1,
      checksum: "wrong",
      data: "YQ==",
    },
    {
      path: ".git",
      type: "file",
      mode: 0o600,
      size: 0,
      checksum: "",
      data: "",
    },
    { path: ".devteleport", type: "directory", mode: 0o700 },
    { path: ".GIT", type: "directory", mode: 0o700 },
    {
      path: "a",
      type: "file",
      mode: 0o600,
      size: 1,
      checksum: "",
      data: "!!!!",
    },
  ])
    assert.throws(() => validateManifest({ ...base, files: [file] }));
});
test("large file limit fails before output, and detached HEAD stays detached", async (t) => {
  const { root, temp } = await fixture(t);
  const handle = await fs.open(path.join(root, "large"), "w");
  await handle.truncate(33 * 1024 * 1024);
  await handle.close();
  await assert.rejects(
    capture({ root, name: "large", output: temp, password }),
    /size limits/,
  );
  await assert.rejects(fs.stat(path.join(temp, "large.dtp")));
  await fs.unlink(path.join(root, "large"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(root, "a"), "a");
  git(root, "add", ".");
  git(root, "commit", "-qm", "a");
  git(root, "checkout", "--detach", "-q");
  const a = await capture({ root, name: "detached", output: temp, password });
  const target = path.join(temp, "restored");
  await restore(a.output, { target, password });
  assert.equal(
    git(target, "rev-parse", "HEAD"),
    git(root, "rev-parse", "HEAD"),
  );
  assert.throws(() => git(target, "symbolic-ref", "--quiet", "HEAD"));
});
test("no side effects from unapproved execution or database instructions", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "a");
  const a = await capture({ root, name: "approval", output: temp, password });
  const target = path.join(temp, "restored");
  await assert.rejects(
    restore(a.output, { target, password, install: true }),
    /approve-execution/,
  );
  await assert.rejects(fs.stat(target));
  await assert.rejects(
    restore(a.output, { target, password, restoreDb: true }),
    /approve-db/,
  );
  await assert.rejects(fs.stat(target));
});
test("restore preserves file mode despite restrictive process umask", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "shared"), "content");
  await fs.chmod(path.join(root, "shared"), 0o766);
  const a = await capture({ root, name: "modes", output: temp, password });
  const target = path.join(temp, "restored");
  const old = process.umask(0o077);
  try {
    const r = await restore(a.output, { target, password });
    assert(r.verification.ok);
    assert.equal(
      (await fs.stat(path.join(target, "shared"))).mode & 0o777,
      0o766,
    );
  } finally {
    process.umask(old);
  }
});
test("Git index stat-cache refresh is accepted but changed staged content fails verification", async (t) => {
  const { root, temp } = await fixture(t);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(root, "a"), "original");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  const a = await capture({ root, name: "index", output: temp, password });
  const target = path.join(temp, "restored");
  await restore(a.output, { target, password });
  git(target, "update-index", "--refresh");
  assert((await verify(target)).ok);
  await fs.writeFile(path.join(target, "a"), "staged");
  git(target, "add", "a");
  await fs.writeFile(path.join(target, "a"), "original");
  const result = await verify(target);
  assert.equal(result.ok, false);
  assert(result.problems.some((x) => x.startsWith(".git/index:")));
  assert(!result.problems.some((x) => x.startsWith("a:")));
});
test("portable encrypted export/import authenticate and refuse overwrites", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "transfer me");
  const a = await capture({ root, name: "transfer", output: temp, password });
  const cli = path.resolve("apps/cli/main.ts"),
    env = { ...process.env, DEVTELEPORT_PASSWORD: password };
  const call = (...args) =>
    execFileSync(process.execPath, [cli, ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const exported = path.join(temp, "export.dtp"),
    imported = path.join(temp, "import.dtp");
  call("export", a.output, "--target", exported);
  call("import", exported, "--target", imported);
  assert.deepEqual(await fs.readFile(a.output), await fs.readFile(imported));
  assert.throws(() => call("export", a.output, "--target", exported));
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [cli, "import", a.output, "--target", path.join(temp, "wrong.dtp")],
      { env: { ...env, DEVTELEPORT_PASSWORD: "incorrect" }, stdio: "pipe" },
    ),
  );
  await assert.rejects(fs.stat(path.join(temp, "wrong.dtp")));
});
