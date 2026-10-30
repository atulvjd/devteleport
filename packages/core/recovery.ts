import fs from "node:fs/promises";
import path from "node:path";
export async function recoveryPlan(directory: string) {
  const root = path.resolve(directory),
    stat = await fs.lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !path.basename(root).startsWith(".devteleport-v2-") ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    throw new Error(
      "Cleanup is restricted to owned private DevTeleport format 2 staging directories.",
    );
  let record;
  for (const candidate of [
    path.join(root, "journal.json"),
    path.join(root, ".devteleport", "journal.json"),
  ]) {
    try {
      const file = await fs.lstat(candidate);
      if (!file.isFile() || file.isSymbolicLink() || file.size > 65536)
        throw new Error("Unsafe recovery journal");
      record = JSON.parse(await fs.readFile(candidate, "utf8"));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (
    !record ||
    record.owner !== "devteleport" ||
    !Number.isInteger(record.pid) ||
    record.pid < 1 ||
    record.formatVersion !== 2
  )
    throw new Error(
      "No recognized operation journal. Preserve this directory for manual inspection.",
    );
  let active = false;
  try {
    process.kill(record.pid, 0);
    active = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH")
      throw new Error(
        "Cannot establish operation inactivity; cleanup refused.",
      );
  }
  if (active)
    throw new Error(
      "The recorded operation process is still active; cleanup refused.",
    );
  const artifacts = [root];
  if (
    typeof record.partial === "string" &&
    path.dirname(record.partial) === path.dirname(root) &&
    /^\.[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}\.dtp\.partial-[a-f0-9-]{36}$/.test(
      path.basename(record.partial),
    )
  ) {
    try {
      const partial = await fs.lstat(record.partial);
      if (
        partial.isFile() &&
        !partial.isSymbolicLink() &&
        (typeof process.getuid !== "function" ||
          partial.uid === process.getuid())
      )
        artifacts.push(record.partial);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return {
    operation: record.operation,
    status: record.status,
    pid: record.pid,
    artifacts,
    approved: false,
    policy:
      "Only private staging and its recognized unpublished partial are eligible. Project directories, databases, existing volumes and final archives are never cleaned.",
  };
}
export async function cleanupRecovery(directory: string, approved: boolean) {
  const plan = await recoveryPlan(directory);
  if (!approved) return plan;
  // Keep the journal until sibling partial cleanup succeeds so a failed
  // filesystem operation can be inspected and retried through the same plan.
  for (const file of plan.artifacts.slice(1))
    await fs.rm(file, { force: true });
  await fs.rm(plan.artifacts[0], { recursive: true, force: false });
  return { ...plan, approved: true, cleaned: true };
}
