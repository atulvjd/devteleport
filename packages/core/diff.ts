import { listWorkspace } from "./index.ts";
import { snapshotMetadata } from "./stream-v2.ts";
import type { SnapshotEntry } from "./types.ts";

export interface DiffChange {
  path: string;
  /** What differs: content, type, link target or permissions. */
  reasons: string[];
}
export interface DiffResult {
  from: string;
  to: string;
  identical: boolean;
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  added: string[];
  removed: string[];
  modified: DiffChange[];
  /** Git internals are summarized, not listed, unless includeGit is set. */
  git: { changedEntries: number; listed: boolean };
}
export interface DiffOptions {
  includeGit?: boolean;
}

const isGitInternal = (p: string) => p === ".git" || p.startsWith(".git/");

function compareEntries(a: SnapshotEntry, b: SnapshotEntry): string[] {
  if (a.type !== b.type) return [`type ${a.type} -> ${b.type}`];
  const reasons: string[] = [];
  if (a.type === "file" && a.checksum !== b.checksum) reasons.push("content");
  if (a.type === "symlink" && a.target !== b.target)
    reasons.push(`link target ${a.target} -> ${b.target}`);
  // Symlink permissions are platform-dependent and never restored.
  if (a.type !== "symlink" && a.mode !== b.mode)
    reasons.push(`permissions ${a.mode.toString(8)} -> ${b.mode.toString(8)}`);
  return reasons;
}

/** Pure comparison of two entry lists. "from" is the older side. */
export function diffEntries(
  from: SnapshotEntry[],
  to: SnapshotEntry[],
  labels: { from: string; to: string },
  options: DiffOptions = {},
): DiffResult {
  const before = new Map(from.map((e) => [e.path, e]));
  const after = new Map(to.map((e) => [e.path, e]));
  const added: string[] = [],
    removed: string[] = [],
    modified: DiffChange[] = [];
  let unchanged = 0,
    gitChanges = 0;
  const record = (p: string, push: () => void) => {
    if (isGitInternal(p)) {
      gitChanges++;
      if (!options.includeGit) return;
    }
    push();
  };
  for (const [p, b] of after) {
    const a = before.get(p);
    if (!a) {
      record(p, () => added.push(p));
      continue;
    }
    const reasons = compareEntries(a, b);
    if (reasons.length) record(p, () => modified.push({ path: p, reasons }));
    else unchanged++;
  }
  for (const p of before.keys())
    if (!after.has(p)) record(p, () => removed.push(p));
  added.sort();
  removed.sort();
  modified.sort((x, y) => x.path.localeCompare(y.path));
  return {
    from: labels.from,
    to: labels.to,
    identical:
      added.length + removed.length + modified.length + gitChanges === 0,
    summary: {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      unchanged,
    },
    added,
    removed,
    modified,
    git: { changedEntries: gitChanges, listed: Boolean(options.includeGit) },
  };
}

/** What changed in a folder since a snapshot was taken. Read-only. */
export async function diffSnapshotWithDirectory(
  snapshot: string,
  directory: string,
  password: string,
  options: DiffOptions = {},
) {
  const manifest = await snapshotMetadata(snapshot, password);
  const { files } = await listWorkspace(directory, manifest.capturePolicy);
  // Files capture skipped for holding credentials were never in the snapshot.
  const secret = new Set(
    manifest.omitted
      .filter((o) => o.endsWith(" (embedded credential detected)"))
      .map((o) => o.replace(/ \(embedded credential detected\)$/, "")),
  );
  return diffEntries(
    manifest.files,
    files.filter((f) => !secret.has(f.path)),
    { from: snapshot, to: directory },
    options,
  );
}

/** What changed between two snapshots. Read-only. */
export async function diffSnapshots(
  older: string,
  newer: string,
  password: string,
  newerPassword: string = password,
  options: DiffOptions = {},
) {
  const a = await snapshotMetadata(older, password);
  const b = await snapshotMetadata(newer, newerPassword);
  return diffEntries(a.files, b.files, { from: older, to: newer }, options);
}
