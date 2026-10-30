import { execFile } from "node:child_process";
import crypto from "node:crypto";
import type { SnapshotEntry } from "./types.ts";
async function git(
  root: string,
  args: string[],
  input?: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        cwd: root,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.startsWith("GIT_"),
            ),
          ),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
        encoding: "buffer",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120000,
      },
      (error, data) =>
        error
          ? reject(
              new Error(
                "Git LFS object analysis failed; repository may be damaged or exceed limits.",
              ),
            )
          : resolve(data),
    );
    child.stdin?.end(input);
  });
}
export async function verifyLfsCompleteness(
  root: string,
  files: SnapshotEntry[],
) {
  const listing = (
    await git(root, [
      "cat-file",
      "--batch-all-objects",
      "--batch-check=%(objectname) %(objecttype) %(objectsize)",
    ])
  ).toString("utf8");
  const candidates = listing
    .split("\n")
    .map((line) => line.split(" "))
    .filter(([, type, size]) => type === "blob" && Number(size) <= 1024)
    .map(([oid]) => oid);
  const inventory = new Map(files.map((file) => [file.path, file]));
  let checked = 0;
  for (let start = 0; start < candidates.length; start += 1000) {
    const bytes = await git(
      root,
      ["cat-file", "--batch"],
      candidates.slice(start, start + 1000).join("\n") + "\n",
    );
    let offset = 0;
    while (offset < bytes.length) {
      const end = bytes.indexOf(10, offset);
      if (end < 0) throw new Error("Invalid Git object batch");
      const [oid, type, length] = bytes
        .subarray(offset, end)
        .toString()
        .split(" ");
      const size = Number(length);
      if (type !== "blob" || !Number.isInteger(size) || size < 0 || size > 1024)
        throw new Error("Invalid Git blob metadata");
      const body = bytes.subarray(end + 1, end + 1 + size).toString("utf8");
      offset = end + size + 2;
      if (!body.startsWith("version https://git-lfs.github.com/spec/v1\n"))
        continue;
      const pointer = body.match(/\noid sha256:([0-9a-f]{64})\nsize (\d+)\n?$/);
      if (!pointer) throw new Error("Invalid Git LFS pointer");
      const hash = pointer[1],
        object = inventory.get(
          `.git/lfs/objects/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`,
        );
      if (
        !object ||
        object.type !== "file" ||
        object.size !== Number(pointer[2]) ||
        object.checksum !== hash
      )
        throw new Error(
          `Git LFS object ${hash} is missing or corrupt. Fetch all LFS objects before capture; an incomplete archive was refused.`,
        );
      checked++;
    }
  }
  return {
    checked,
    status:
      "all locally stored Git pointer blobs checked against captured LFS objects",
  };
}
