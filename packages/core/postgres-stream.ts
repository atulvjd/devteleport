import fs from "node:fs/promises";
import { run, dbEnv } from "./index.ts";
import type {
  DatabaseConfig,
  DatabaseRecord,
  WorkspaceConfig,
} from "./types.ts";
export async function dumpDatabase(
  root: string,
  config: WorkspaceConfig,
  d: DatabaseConfig,
  file: string,
) {
  const started = performance.now();
  const env = await dbEnv(config, d);
  const serverVersion = Number(
    await run(
      "psql",
      [
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "SHOW server_version_num",
      ],
      root,
      { env },
    ),
  );
  const toolVersion = await run("pg_dump", ["--version"], root),
    major = Number(toolVersion.match(/(\d+)\./)?.[1]);
  if (
    !Number.isInteger(serverVersion) ||
    serverVersion < 100000 ||
    !major ||
    major < Math.floor(serverVersion / 10000)
  )
    throw new Error(
      "pg_dump must match or exceed the source PostgreSQL major version (10+).",
    );
  const databaseBytes = Number(
    await run(
      "psql",
      [
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "SELECT pg_database_size(current_database())",
      ],
      root,
      { env },
    ),
  );
  const controller = new AbortController();
  let exceeded = false;
  const monitor = setInterval(async () => {
    try {
      const size = (await fs.stat(file)).size,
        space = await fs.statfs(file);
      if (
        size > 16 * 1024 ** 3 ||
        Number(space.bavail) * Number(space.bsize) < 64 * 1024 ** 2
      ) {
        exceeded = true;
        controller.abort();
      }
    } catch {}
  }, 250);
  monitor.unref();
  try {
    await run(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--file",
        file,
        ...(d.excludeSchemas ?? []).map((x) => "--exclude-schema=" + x),
        ...(d.excludeTables ?? []).map((x) => "--exclude-table=" + x),
      ],
      root,
      { env, timeout: 3600000, signal: controller.signal },
    );
  } catch (error) {
    if (exceeded)
      throw new Error(
        "Database export exceeded streaming size or available-storage limits.",
      );
    throw error;
  } finally {
    clearInterval(monitor);
  }
  await fs.chmod(file, 0o600);
  await run("pg_restore", ["--list", file], root);
  return {
    backupMilliseconds: performance.now() - started,
    dumpBytes: (await fs.stat(file)).size,
    name: d.name,
    format: "postgres-custom",
    toolVersion,
    serverVersion,
    databaseBytes,
    exclusions: {
      schemas: d.excludeSchemas ?? [],
      tables: d.excludeTables ?? [],
    },
  };
}
export async function restoreDatabase(
  root: string,
  c: WorkspaceConfig,
  d: DatabaseRecord,
  file: string,
) {
  const env = await dbEnv(
    c,
    c.databases?.find((x) => x.name === d.name),
  );
  const version = Number(
    await run(
      "psql",
      [
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "SHOW server_version_num",
      ],
      root,
      { env },
    ),
  );
  const restoreVersion = Number(
    (await run("pg_restore", ["--version"], root)).match(/(\d+)\./)?.[1],
  );
  const dumpVersion = Number(d.toolVersion.match(/(\d+)\./)?.[1]);
  if (
    !restoreVersion ||
    restoreVersion < dumpVersion ||
    Math.floor(version / 10000) <
      Math.max(Math.floor((d.serverVersion ?? 0) / 10000), dumpVersion)
  )
    throw new Error(
      "Destination PostgreSQL and pg_restore must not be older than the captured server/dump utility.",
    );
  const count = await run(
    "psql",
    [
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%';",
    ],
    root,
    { env },
  );
  if (count !== "0")
    throw new Error(
      "Target database is not empty; restore refused. Source files remain restored.",
    );
  await run(
    "pg_restore",
    [
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      "--single-transaction",
      "--dbname",
      env.PGDATABASE,
      file,
    ],
    root,
    { env, timeout: 3600000 },
  );
}
