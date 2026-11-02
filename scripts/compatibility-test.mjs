import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-compatibility-"));
try {
  const archive = path.resolve("dist/devteleport-0.2.0.tgz");
  const expected =
    "5e78786224e56247f27810c72929a0a7e57f46ab47d8be2f3a10c54591b92e3e";
  const actual = crypto
    .createHash("sha256")
    .update(await fs.readFile(archive))
    .digest("hex");
  assert.equal(
    actual,
    expected,
    "Use the exact originally published 0.2.0 package",
  );
  execFileSync("tar", ["-xzf", archive, "-C", temp]);
  const old = await import(
    pathToFileURL(path.join(temp, "package/packages/core/index.js")).href
  );
  const current = await import(
    pathToFileURL(path.resolve("dist/cli/packages/core/index.js")).href
  );
  const version = JSON.parse(
    await fs.readFile("dist/cli/package.json", "utf8"),
  ).version;
  assert.equal(
    version,
    JSON.parse(await fs.readFile("package.json", "utf8")).version,
  );
  const records = [];
  for (const format of [1, 2])
    for (const direction of ["old-to-current", "current-to-old"]) {
      const root = path.join(temp, direction + format),
        target = root + "-restored";
      await fs.mkdir(path.join(root, "node_modules/demo"), { recursive: true });
      await fs.writeFile(
        path.join(root, "hello.txt"),
        "independent compatibility",
      );
      await fs.writeFile(path.join(root, ".env"), "LOCAL_FIXTURE=private-only");
      await fs.writeFile(
        path.join(root, "node_modules/demo/runtime"),
        "generated dependency",
      );
      const writer = direction === "old-to-current" ? old : current,
        reader = writer === old ? current : old;
      const password = "compatibility release passphrase";
      const captured = await writer.capture({
        root,
        format,
        name: direction + format,
        output: temp,
        password,
        ...(writer === current
          ? { includeIgnored: true, excludeGenerated: true }
          : {}),
      });
      await fs.rm(root, { recursive: true });
      await reader.restore(captured.output, { target, password });
      assert.equal(
        await fs.readFile(path.join(target, "hello.txt"), "utf8"),
        "independent compatibility",
      );
      await assert.rejects(fs.stat(path.join(target, "node_modules")), {
        code: "ENOENT",
      });
      if (writer === current)
        assert.equal(
          await fs.readFile(path.join(target, ".env"), "utf8"),
          "LOCAL_FIXTURE=private-only",
        );
      assert(
        (await reader.verifyFromSnapshot(target, captured.output, password)).ok,
      );
      records.push({ format, direction, sourceRemoved: true, verified: true });
    }
  const report = {
    at: new Date().toISOString(),
    version,
    published020Sha256: expected,
    records,
    ok: true,
  };
  await fs.mkdir("dist/evidence", { recursive: true });
  await fs.writeFile(
    "dist/evidence/archive-compatibility.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
