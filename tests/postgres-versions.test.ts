import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { capture, restore, readSnapshot } from "../packages/core/index.ts";
const tool = (name, args, env = process.env) =>
  execFileSync(name, args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  }).trim();
test("real PostgreSQL 15-to-16 restore and older-client capture refusal", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-pg-versions-")),
    id = crypto.randomBytes(5).toString("hex"),
    names = ["dtp-pg15-" + id, "dtp-pg16-" + id];
  t.after(async () => {
    for (const name of names)
      try {
        tool("docker", ["rm", "-f", name]);
      } catch {}
    delete process.env.DTP_MULTI_SOURCE;
    delete process.env.DTP_MULTI_DEST;
    await fs.rm(temp, { recursive: true, force: true });
  });
  const urls = [];
  const connectionEnv = (value) => {
    const url = new URL(value);
    return {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: url.username,
      PGDATABASE: url.pathname.slice(1),
    };
  };
  for (let i = 0; i < 2; i++) {
    tool("docker", ["pull", `postgres:${15 + i}-alpine`]);
    tool("docker", [
      "run",
      "-d",
      "--name",
      names[i],
      "-p",
      "127.0.0.1::5432",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_DB=teleport_dev",
      `postgres:${15 + i}-alpine`,
    ]);
    const info = JSON.parse(tool("docker", ["inspect", names[i]]))[0];
    const port = info.NetworkSettings.Ports["5432/tcp"][0].HostPort;
    urls.push(`postgresql://postgres@127.0.0.1:${port}/teleport_dev`);
    const env = {
      ...process.env,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGUSER: "postgres",
      PGDATABASE: "teleport_dev",
      PGCONNECT_TIMEOUT: "2",
    };
    let ready = false;
    for (let j = 0; j < 100; j++) {
      try {
        tool("psql", ["-X", "-A", "-t", "-c", "SELECT 1"], env);
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert(ready);
  }
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "devteleport.json"),
    JSON.stringify({
      databases: [{ name: "app", connectionEnv: "DTP_MULTI_SOURCE" }],
    }),
  );
  process.env.DTP_MULTI_SOURCE = urls[0];
  process.env.DTP_MULTI_DEST = urls[1];
  tool(
    "psql",
    [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "CREATE TABLE records(body text);INSERT INTO records VALUES('forward version restore');",
    ],
    connectionEnv(urls[0]),
  );
  const password = "multi version postgres password";
  const a = await capture({
    root,
    name: "versions",
    output: temp,
    password,
    includeDb: true,
  });
  const m = await readSnapshot(a.output, password);
  assert.equal(Math.floor(m.databases[0].serverVersion / 10000), 15);
  tool("docker", ["rm", "-f", names[0]]);
  const cfg = path.join(temp, "target.json");
  await fs.writeFile(
    cfg,
    JSON.stringify({
      databases: [{ name: "app", connectionEnv: "DTP_MULTI_DEST" }],
    }),
  );
  await restore(a.output, {
    target: path.join(temp, "restored"),
    password,
    restoreDb: true,
    approveDb: true,
    dbConfig: cfg,
  });
  assert.equal(
    tool(
      "psql",
      ["-X", "-A", "-t", "-c", "SELECT body FROM records"],
      connectionEnv(urls[1]),
    ),
    "forward version restore",
  );
  process.env.DTP_MULTI_SOURCE = urls[1];
  const hostMajor = Number(tool("pg_dump", ["--version"]).match(/(\d+)\./)[1]);
  assert.equal(
    hostMajor,
    15,
    "This local version-compatibility fixture requires pg_dump 15",
  );
  await assert.rejects(
    capture({
      root,
      name: "refuse-newer",
      output: temp,
      password,
      includeDb: true,
    }),
    /pg_dump must match or exceed/,
  );
});
