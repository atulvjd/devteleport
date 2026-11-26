import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { nodeSatisfies } from "./setup.ts";
import type { DependencyPlan } from "./setup.ts";
import {
  environmentRequirements,
  type EnvironmentPreview,
} from "./environment.ts";

async function storage(directory: string, required: number) {
  let parent = path.resolve(directory);
  for (;;) {
    try {
      const stat = await fs.statfs(parent);
      const available = Number(stat.bavail) * Number(stat.bsize);
      return {
        directory: parent,
        available,
        required,
        sufficient: available >= required,
      };
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        path.dirname(parent) === parent
      )
        throw error;
      parent = path.dirname(parent);
    }
  }
}
export async function restoreReadiness(input: {
  target: string;
  bytes: number;
  dependencies: DependencyPlan;
  install?: boolean;
  dbConfig?: string;
  restoreDb?: boolean;
  restoreVolumes?: boolean;
  databases?: string[];
  volumes?: string[];
  tools: { tool: string; available: boolean }[];
  environment: EnvironmentPreview[];
  environmentSchema?: { path: string; keys: string[] }[];
}) {
  const targetStorage = await storage(
    path.dirname(input.target),
    input.bytes + 64 * 1024 ** 2,
  );
  const stagingStorage = await storage(
    os.tmpdir(),
    input.bytes + 64 * 1024 ** 2,
  );
  const shared =
    targetStorage.directory === stagingStorage.directory ||
    (await fs.stat(targetStorage.directory)).dev ===
      (await fs.stat(stagingStorage.directory)).dev;
  if (shared) {
    targetStorage.required = input.bytes * 2 + 128 * 1024 ** 2;
    targetStorage.sufficient =
      targetStorage.available >= targetStorage.required;
  }
  const mappingChecks: { name: string; state: string; fix: string }[] = [];
  if (input.restoreDb || input.restoreVolumes) {
    let mapping:
      | {
          databases?: { name: string; connectionEnv: string }[];
          volumes?: { name: string; volume: string }[];
        }
      | undefined;
    try {
      if (!input.dbConfig || (await fs.stat(input.dbConfig)).size > 1024 * 1024)
        throw new Error();
      mapping = JSON.parse(await fs.readFile(input.dbConfig, "utf8"));
      if (!mapping || typeof mapping !== "object") throw new Error();
    } catch {
      mappingChecks.push({
        name: "Trusted destination mapping",
        state: "blocked",
        fix: "Select a valid external database/volume mapping file and review again.",
      });
    }
    if (mapping && input.restoreDb)
      for (const name of input.databases ?? []) {
        const target = Array.isArray(mapping.databases)
          ? mapping.databases.find((item) => item?.name === name)
          : undefined;
        const key = target?.connectionEnv;
        const valid =
          typeof key === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(key);
        mappingChecks.push({
          name: valid
            ? `Database ${name} environment ${key}`
            : `Database ${name} destination`,
          state: valid && process.env[key] ? "ready" : "blocked",
          fix:
            valid && process.env[key]
              ? ""
              : valid
                ? `Set ${key} in the app's launch environment with the new empty development database connection, then review again.`
                : "Map this database alias to a connectionEnv name in the trusted external mapping.",
        });
      }
    if (mapping && input.restoreVolumes)
      for (const name of input.volumes ?? []) {
        const target = Array.isArray(mapping.volumes)
          ? mapping.volumes.find((item) => item?.name === name)
          : undefined;
        mappingChecks.push({
          name: `Volume ${name} destination`,
          state: target?.volume ? "ready" : "blocked",
          fix: target?.volume
            ? ""
            : "Map this volume alias to a new destination volume name in the trusted external mapping.",
        });
      }
  }
  const checks = [
    ...mappingChecks,
    ...input.tools.map((tool) => ({
      name: tool.tool,
      state: tool.available ? "ready" : "blocked",
      fix: tool.available
        ? ""
        : `Install a compatible native ${tool.tool} executable and add its directory in Settings.`,
    })),
    ...input.dependencies.tools.map((tool) => ({
      name: tool.name,
      version: tool.version,
      state:
        tool.file && tool.version
          ? "ready"
          : input.install
            ? "blocked"
            : "warning",
      fix:
        tool.file && tool.version
          ? ""
          : `Install ${tool.name} for this machine, then review again.`,
    })),
    ...input.dependencies.packages.flatMap((pkg) => {
      const requirement = pkg.requiredPython;
      if (!requirement) return [];
      const actual = input.dependencies.tools
        .find((tool) => tool.name === "python3")
        ?.version?.match(/\d+\.\d+\.\d+/)?.[0];
      const compatible = actual
        ? nodeSatisfies(actual, requirement.replace(/,/g, " "))
        : false;
      return [
        {
          name: `${pkg.directory} Python ${requirement}`,
          version: actual || "unavailable",
          state:
            compatible === true
              ? "ready"
              : input.install
                ? "blocked"
                : "warning",
          fix:
            compatible === true
              ? ""
              : `Configure Python ${requirement} for this project and review again. Unrecognized version constraints require manual verification.`,
        },
      ];
    }),
    ...input.dependencies.blockers.map((message) => ({
      name: message,
      state: input.install ? "blocked" : "warning",
      fix: "Resolve the reported runtime/version or manifest issue, or restore files with installation off.",
    })),
    ...[targetStorage, stagingStorage].map((space, index) => ({
      name: index === 0 ? "Destination storage" : "Authentication storage",
      state: space.sufficient ? "ready" : "blocked",
      fix: space.sufficient
        ? ""
        : "Free disk space or choose a destination on another volume.",
    })),
  ];
  return {
    ready: checks.every((check) => check.state !== "blocked"),
    checks,
    storage: {
      target: targetStorage,
      staging: stagingStorage,
      installationBytes:
        "Additional dependency download/build space varies by project.",
    },
    environment: environmentRequirements(
      input.environment,
      input.environmentSchema,
    ),
    environmentNote:
      "Expected names come from source environment files and templates. Configure missing values before startup. Values are hidden.",
  };
}
