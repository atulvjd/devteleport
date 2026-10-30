import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { capture, restore, startServices } from "../packages/core/index.ts";
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
test("live named-volume capture and independent restore; existing-volume refusal; Compose startup", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-docker-live-")),
    id = crypto.randomBytes(6).toString("hex"),
    source = "dtp-source-" + id,
    dest = "dtp-dest-" + id,
    project = "dtp-" + id;
  t.after(async () => {
    try {
      docker(
        "compose",
        "-p",
        project,
        "-f",
        path.join(temp, "compose.yaml"),
        "down",
        "--volumes",
      );
    } catch {}
    for (const v of [source, dest])
      try {
        docker("volume", "rm", v);
      } catch {}
    await fs.rm(temp, { recursive: true, force: true });
  });
  docker("pull", "python:3.13-alpine");
  docker("volume", "create", source);
  docker(
    "run",
    "--rm",
    "--network",
    "none",
    "--mount",
    `type=volume,src=${source},dst=/data`,
    "python:3.13-alpine",
    "python",
    "-c",
    "open('/data/record.txt','w').write('volume data survived independently')",
  );
  const root = path.join(temp, "project");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "devteleport.json"),
    JSON.stringify({ volumes: [{ name: "data", volume: source }] }),
  );
  const password = "docker volume integration password";
  const a = await capture({
    root,
    name: "volumes",
    output: temp,
    password,
    includeVolumes: true,
  });
  docker("volume", "rm", source);
  await fs.rm(root, { recursive: true });
  const cfg = path.join(temp, "target.json");
  await fs.writeFile(
    cfg,
    JSON.stringify({ volumes: [{ name: "data", volume: dest }] }),
  );
  await restore(a.output, {
    password,
    target: path.join(temp, "restored"),
    restoreVolumes: true,
    approveVolumes: true,
    dbConfig: cfg,
  });
  assert.equal(
    docker(
      "run",
      "--rm",
      "--network",
      "none",
      "--mount",
      `type=volume,src=${dest},dst=/data,readonly`,
      "python:3.13-alpine",
      "python",
      "-c",
      "print(open('/data/record.txt').read())",
    ),
    "volume data survived independently",
  );
  await assert.rejects(
    restore(a.output, {
      password,
      target: path.join(temp, "refused"),
      restoreVolumes: true,
      approveVolumes: true,
      dbConfig: cfg,
    }),
    /already exists/,
  );
  await fs.writeFile(
    path.join(temp, "compose.yaml"),
    `name: ${project}\nservices:\n  worker:\n    image: python:3.13-alpine\n    command: [python, -c, "import time;time.sleep(120)"]\n`,
  );
  await assert.rejects(startServices(temp), /approve-execution/);
  await startServices(temp, true);
  assert(
    docker(
      "compose",
      "-f",
      path.join(temp, "compose.yaml"),
      "ps",
      "--status",
      "running",
      "--services",
    ).includes("worker"),
  );
});
