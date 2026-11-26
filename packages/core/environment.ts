import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { generatedDirectories } from "./capture-policy.ts";
import type { SnapshotEntry } from "./types.ts";

/** Read at most 1 MiB, including if a file grows during review. */
export async function readEnvironmentFile(
  handle: import("node:fs/promises").FileHandle,
) {
  const limit = 1024 * 1024,
    buffer = Buffer.alloc(limit + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      length,
      buffer.length - length,
      length,
    );
    if (!bytesRead) break;
    length += bytesRead;
  }
  return length > limit ? null : buffer.subarray(0, length).toString("utf8");
}

export const isEnvironmentFile = (file: string) =>
  /(^|\/)\.env(?:\.[^/]*)?$/.test(file);
export const environmentKeys = (text: string) =>
  [
    ...new Set(
      [...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)]
        .map((match) => match[1])
        .filter((key) => key.length <= 256),
    ),
  ].sort();
function configuredKeys(text: string) {
  return [
    ...new Set(
      [
        ...text.matchAll(
          /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)$/gm,
        ),
      ]
        .filter((match) => {
          const value = match[2].trim();
          return (
            value && !value.startsWith("#") && !["''", '\"\"'].includes(value)
          );
        })
        .map((match) => match[1]),
    ),
  ].sort();
}
export type EnvironmentPreview = {
  path: string;
  keys: string[];
  template: boolean;
  included: boolean;
  configuredKeys?: string[];
  note?: string;
};
export async function previewEnvironment(
  entries: SnapshotEntry[],
  read: (entry: SnapshotEntry) => Promise<Buffer>,
): Promise<EnvironmentPreview[]> {
  const result: EnvironmentPreview[] = [];
  for (const entry of entries) {
    if (entry.type !== "file" || !isEnvironmentFile(entry.path)) continue;
    if (entry.size > 1024 * 1024) {
      result.push({
        path: entry.path,
        keys: [],
        template: false,
        included: true,
        note: "File exceeds the 1 MiB variable-name review limit. Review its configuration manually.",
      });
      continue;
    }
    const text = (await read(entry)).toString("utf8");
    result.push({
      path: entry.path,
      keys: environmentKeys(text),
      configuredKeys: configuredKeys(text),
      template: /\.(example|sample|template)$/.test(entry.path),
      included: true,
    });
  }
  return result;
}
export async function scanEnvironment(
  directory: string,
  exclusions: string[] = [],
) {
  const root = await fs.realpath(directory),
    entries: EnvironmentPreview[] = [];
  let visited = 0;
  async function walk(relative: string) {
    for (const item of await fs.readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      if (++visited > 50000)
        throw new Error(
          "Environment review exceeds 50,000 entries. Choose a smaller project.",
        );
      if (
        item.isSymbolicLink() ||
        generatedDirectories.has(item.name) ||
        [
          ".git",
          ".ssh",
          ".aws",
          ".gnupg",
          ".kube",
          ".docker",
          ".azure",
          ".venv",
          "venv",
          "vendor",
          "target",
          ".gradle",
          ".devteleport",
        ].includes(item.name)
      )
        continue;
      const file = relative ? relative + "/" + item.name : item.name;
      if (
        exclusions.some(
          (prefix) => file === prefix || file.startsWith(prefix + "/"),
        )
      )
        continue;
      if (item.isDirectory()) await walk(file);
      else if (item.isFile() && isEnvironmentFile(file)) {
        const handle = await fs.open(
          path.join(root, file),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          if ((await handle.stat()).size > 1024 * 1024) {
            entries.push({
              path: file,
              keys: [],
              template: false,
              included: false,
              note: "Variable names need manual review because this file exceeds 1 MiB.",
            });
            continue;
          }
          const text = await readEnvironmentFile(handle);
          if (text === null)
            throw new Error("Environment file grew beyond review limit");
          entries.push({
            path: file,
            keys: environmentKeys(text),
            template: /\.(example|sample|template)$/.test(file),
            included: false,
          });
        } finally {
          await handle.close();
        }
      }
    }
  }
  await walk("");
  return { root, files: entries.sort((a, b) => a.path.localeCompare(b.path)) };
}
export function environmentRequirements(
  files: EnvironmentPreview[],
  schema: { path: string; keys: string[] }[] = files,
) {
  const supplied = new Map<string, Set<string>>();
  for (const file of files.filter((file) => !file.template)) {
    const directory = path.posix.dirname(file.path);
    const keys = supplied.get(directory) ?? new Set<string>();
    for (const key of file.configuredKeys ?? []) keys.add(key);
    supplied.set(directory, keys);
  }
  const expected = new Map<string, Set<string>>();
  for (const file of schema) {
    const directory = path.posix.dirname(file.path),
      keys = expected.get(directory) ?? new Set<string>();
    for (const key of file.keys) keys.add(key);
    expected.set(directory, keys);
  }
  return [...expected].map(([directory, keys]) => ({
    directory,
    expected: [...keys].sort(),
    missing: [...keys]
      .filter((key) => !supplied.get(directory)?.has(key) && !process.env[key])
      .sort(),
  }));
}
