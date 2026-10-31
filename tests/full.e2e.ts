import { test } from "node:test";
import { waitForPort } from "./wait-for-port.ts";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("combined independent Express, Git, PostgreSQL and Compose reconstruction", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-full-"));
  let started = false,
    server;
  const cluster = path.join(temp, "cluster"),
    port = String(20000 + Math.floor(Math.random() * 20000));
  const baseEnv = {
    ...process.env,
    PGHOST: "127.0.0.1",
    PGPORT: port,
    PGUSER: os.userInfo().username,
  };
  const tool = (name, args, env = baseEnv) =>
    execFileSync(name, args, {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  t.after(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await exited;
    }
    if (started)
      tool("pg_ctl", ["-D", cluster, "-m", "immediate", "-w", "stop"]);
    await fs.rm(temp, { recursive: true, force: true });
  });
  tool("initdb", ["-D", cluster, "-A", "trust", "--no-locale"]);
  tool("pg_ctl", [
    "-D",
    cluster,
    "-l",
    path.join(temp, "pg.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${temp}`,
    "-w",
    "start",
  ]);
  started = true;
  tool("createdb", ["source_dev"]);
  tool("createdb", ["destination_dev"]);
  tool("psql", [
    "-d",
    "source_dev",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE TABLE messages(body text); INSERT INTO messages VALUES('database arrived independently');",
  ]);
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "independent-fixture",
      version: "1.0.0",
      private: true,
      type: "module",
      dependencies: { express: "^5.1.0", pg: "^8.16.0" },
    }),
  );
  await fs.writeFile(path.join(root, ".gitignore"), "node_modules/\n.env\n");
  await fs.writeFile(
    path.join(root, "devteleport.json"),
    JSON.stringify({
      databases: [{ name: "app", connectionEnv: "DTP_FULL_SOURCE" }],
    }),
  );
  await fs.writeFile(
    path.join(root, "compose.yaml"),
    "services:\n  database:\n    image: postgres:15-alpine\n    environment:\n      POSTGRES_HOST_AUTH_METHOD: trust\n",
  );
  await fs.writeFile(
    path.join(root, "server.mjs"),
    "import express from 'express';import pg from 'pg';const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});const app=express();app.get('/',async(q,r)=>{try{r.json((await pool.query('SELECT body FROM messages')).rows);}catch(e){r.status(500).end();}});const s=app.listen(0,'127.0.0.1',()=>console.log(s.address().port));",
  );
  await exec(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--fetch-retries=0",
      "--fetch-timeout=20000",
    ],
    { cwd: root },
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("add", ".");
  git("commit", "-qm", "working app");
  await fs.appendFile(
    path.join(root, "server.mjs"),
    "\n// uncommitted source change\n",
  );
  await fs.writeFile(path.join(root, "notes.txt"), "untracked context");
  const before = git("status", "--porcelain");
  const url = (name) =>
    `postgresql://${baseEnv.PGUSER}@127.0.0.1:${port}/${name}`;
  const env = {
    ...process.env,
    DEVTELEPORT_PASSWORD: "combined independent fixture password",
    DTP_FULL_SOURCE: url("source_dev"),
    DTP_FULL_DESTINATION: url("destination_dev"),
  };
  const cli = path.resolve("apps/cli/main.ts");
  const call = async (args) =>
    JSON.parse(
      (
        await exec(process.execPath, [cli, ...args], {
          env,
          maxBuffer: 16 * 1024 * 1024,
        })
      ).stdout,
    );
  const compose = await call(["services", root]);
  assert.equal(compose.services[0].image, "postgres:15-alpine");
  assert.equal(compose.volumesCaptured, false);
  const a = await call([
    "capture",
    "--root",
    root,
    "--name",
    "full",
    "--output",
    temp,
    "--include-db",
  ]);
  assert.deepEqual(a.databases, ["app"]);
  await fs.rm(root, { recursive: true });
  tool("dropdb", ["source_dev"]);
  const target = path.join(temp, "destination");
  const cfg = path.join(temp, "trusted-target.json");
  await fs.writeFile(
    cfg,
    JSON.stringify({
      databases: [{ name: "app", connectionEnv: "DTP_FULL_DESTINATION" }],
    }),
  );
  const result = await call([
    "restore",
    a.output,
    "--target",
    target,
    "--restore-db",
    "--approve-db",
    "--db-config",
    cfg,
    "--install",
    "--approve-execution",
  ]);
  assert(result.verification.ok);
  const after = execFileSync("git", ["status", "--porcelain"], {
    cwd: target,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((x) => !x.includes(".devteleport/"))
    .join("\n");
  assert.equal(after, before);
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: target,
    env: { ...process.env, DATABASE_URL: url("destination_dev") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appPort = await waitForPort(server, "Restored Express");
  const response = await fetch(`http://127.0.0.1:${appPort}/`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    { body: "database arrived independently" },
  ]);
  assert((await call(["verify", target])).ok);
});
