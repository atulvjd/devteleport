import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { capture, restore } from "../packages/core/index.ts";
// Explicit integration target, not silently skipped in the default suite.
if (process.env.DEVTELEPORT_TEST_POSTGRES === "1")
  test("real PostgreSQL independent restore and nonempty destination protection", async (t) => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-pg-"));
    let started = false;
    const port = String(20000 + Math.floor(Math.random() * 20000));
    const run = (tool, args, env = {}) =>
      execFileSync(tool, args, {
        encoding: "utf8",
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    t.after(async () => {
      if (started)
        run("pg_ctl", [
          "-D",
          path.join(temp, "cluster"),
          "-m",
          "immediate",
          "-w",
          "stop",
        ]);
      await fs.rm(temp, { recursive: true, force: true });
    });
    run("initdb", [
      "-D",
      path.join(temp, "cluster"),
      "-A",
      "trust",
      "--no-locale",
    ]);
    run("pg_ctl", [
      "-D",
      path.join(temp, "cluster"),
      "-l",
      path.join(temp, "server.log"),
      "-o",
      `-h 127.0.0.1 -p ${port} -k ${temp}`,
      "-w",
      "start",
    ]);
    started = true;
    const env = {
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGUSER: os.userInfo().username,
    };
    run("createdb", ["source_dev"], env);
    run("createdb", ["target_dev"], env);
    run(
      "psql",
      [
        "-d",
        "source_dev",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "CREATE TABLE records(id integer PRIMARY KEY, message text); INSERT INTO records VALUES(1,'independent restore');",
      ],
      env,
    );
    const root = path.join(temp, "project");
    await fs.mkdir(root);
    await fs.writeFile(
      path.join(root, "devteleport.json"),
      JSON.stringify({
        databases: [{ name: "app", connectionEnv: "DTP_SOURCE_DB" }],
      }),
    );
    process.env.DTP_SOURCE_DB = `postgresql://${env.PGUSER}@127.0.0.1:${port}/source_dev`;
    process.env.DTP_TARGET_DB = `postgresql://${env.PGUSER}@127.0.0.1:${port}/target_dev`;
    const password = "postgres roundtrip password";
    const a = await capture({
      root,
      name: "database",
      output: temp,
      password,
      includeDb: true,
    });
    run("dropdb", ["source_dev"], env);
    await fs.rm(root, { recursive: true });
    const cfg = path.join(temp, "target.json");
    await fs.writeFile(
      cfg,
      JSON.stringify({
        databases: [{ name: "app", connectionEnv: "DTP_TARGET_DB" }],
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
      run(
        "psql",
        ["-d", "target_dev", "-A", "-t", "-c", "SELECT message FROM records"],
        env,
      ),
      "independent restore",
    );
    await assert.rejects(
      restore(a.output, {
        target: path.join(temp, "refused"),
        password,
        restoreDb: true,
        approveDb: true,
        dbConfig: cfg,
      }),
      /not empty/,
    );
    delete process.env.DTP_SOURCE_DB;
    delete process.env.DTP_TARGET_DB;
  });
