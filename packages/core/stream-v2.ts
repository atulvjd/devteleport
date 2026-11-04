import { publishNoReplace } from "./atomic.ts";
import { capturePolicy, generatedWarnings } from "./capture-policy.ts";
import { reviewDependencies, installDependencies } from "./setup.ts";
import { throwIfCancelled } from "./processes.ts";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream, constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  inspect,
  config,
  enumerate,
  optional,
  safePath,
  run,
  validateManifest,
  readSnapshot,
  verify,
  IGNORED_CAPTURE_WARNING,
} from "./index.ts";
import { verifyLfsCompleteness } from "./lfs.ts";
import { dumpDatabase, restoreDatabase } from "./postgres-stream.ts";
import { captureVolume, restoreVolume } from "./docker.ts";
import type {
  CaptureOptions,
  RestoreOptions,
  Manifest,
  SnapshotEntry,
  DatabaseRecord,
  VolumeRecord,
  WorkspaceConfig,
} from "./types.ts";
export const V2_LIMITS = {
  file: 16 * 1024 ** 3,
  total: 32 * 1024 ** 3,
  metadata: 16 * 1024 ** 2,
  entries: 50000,
  chunk: 256 * 1024,
};
const EMPTY = crypto.createHash("sha256").update("").digest("hex");
const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    crypto.scrypt(
      password,
      salt,
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 ** 2 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export async function hashFile(file: string) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file, {
    highWaterMark: V2_LIMITS.chunk,
  }))
    hash.update(chunk);
  return hash.digest("hex");
}
export async function isV2(file: string) {
  const handle = await fs.open(file, "r");
  try {
    const b = Buffer.alloc(4);
    await handle.read(b, 0, 4, 0);
    return b.toString() === "DTP2";
  } finally {
    await handle.close();
  }
}
async function available(directory: string, bytes: number) {
  const stat = await fs.statfs(directory);
  if (Number(stat.bavail) * Number(stat.bsize) < bytes + 64 * 1024 ** 2)
    throw new Error(
      "Not enough free storage for secure snapshot staging. Choose another destination or free disk space.",
    );
}
async function durable(file: string, value: unknown) {
  const tmp = file + ".tmp-" + crypto.randomUUID(),
    handle = await fs.open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
}
async function present(file: string) {
  try {
    await fs.lstat(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
type BlobMeta = { size: number; checksum: string };
function blobs(m: Manifest): BlobMeta[] {
  return [
    ...m.files.filter((f) => f.type === "file"),
    ...m.databases,
    ...(m.volumes ?? []),
  ] as BlobMeta[];
}
function validateV2(value: unknown): Manifest {
  const m = value as Manifest;
  if (
    !m ||
    m.formatVersion !== 2 ||
    !Array.isArray(m.files) ||
    !Array.isArray(m.databases) ||
    !Array.isArray(m.volumes ?? [])
  )
    throw new Error("Invalid format 2 metadata");
  if (
    m.files.length > V2_LIMITS.entries ||
    m.databases.length > 50 ||
    (m.volumes ?? []).length > 50
  )
    throw new Error("Snapshot metadata count exceeds limits");
  // Reuse the existing path, reserved-name, collision, parent and symlink validator.
  validateManifest({
    ...m,
    formatVersion: 1,
    databases: [],
    volumes: [],
    files: m.files.map((f) =>
      f.type === "file" ? { ...f, size: 0, checksum: EMPTY, data: "" } : f,
    ),
  });
  let total = 0;
  for (const item of blobs(m)) {
    if (
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      item.size > V2_LIMITS.file ||
      typeof item.checksum !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.checksum)
    )
      throw new Error("Invalid streaming payload metadata");
    total += item.size;
  }
  if (total > V2_LIMITS.total)
    throw new Error("Snapshot exceeds streaming payload limit");
  for (const group of [m.databases, m.volumes ?? []]) {
    const names = new Set();
    for (const d of group) {
      if (
        typeof d.name !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(d.name) ||
        names.has(d.name)
      )
        throw new Error("Invalid/duplicate component name");
      names.add(d.name);
    }
  }
  if (
    m.databases.some(
      (d) =>
        d.format !== "postgres-custom" ||
        typeof d.toolVersion !== "string" ||
        (d.serverVersion !== undefined &&
          (!Number.isSafeInteger(d.serverVersion) || d.serverVersion < 100000)),
    )
  )
    throw new Error("Unsupported database metadata");
  if (
    (m.volumes ?? []).some(
      (v) => v.format !== "docker-local-tar-gzip" || v.size > 32 * 1024 ** 2,
    )
  )
    throw new Error("Unsupported named-volume payload");
  return m;
}
async function copyHashed(
  source: AsyncIterable<Buffer | string>,
  destination?: string,
  maximum = V2_LIMITS.file,
) {
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const hashStream = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximum) {
        callback(new Error("Source grew beyond its approved size"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  if (destination)
    await pipeline(
      Readable.from(source),
      hashStream,
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    );
  else {
    for await (const chunk of source) {
      bytes += Buffer.byteLength(chunk);
      hash.update(chunk);
    }
  }
  return { checksum: hash.digest("hex"), size: bytes };
}
async function* range(file: string, start: number, size: number) {
  if (size)
    yield* createReadStream(file, {
      start,
      end: start + size - 1,
      highWaterMark: V2_LIMITS.chunk,
    });
}
async function embeddedSecret(file: string, maximum: number) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let tail = "",
    bytes = 0;
  try {
    for await (const chunk of handle.createReadStream({
      highWaterMark: V2_LIMITS.chunk,
      autoClose: false,
    })) {
      throwIfCancelled();
      bytes += chunk.length;
      if (bytes > maximum) throw new Error("Source grew during review");
      const text = tail + chunk.toString("latin1");
      if (
        /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}/.test(
          text,
        )
      )
        return true;
      tail = text.slice(-256);
    }
    return false;
  } finally {
    await handle.close();
  }
}
export async function captureV2(options: CaptureOptions) {
  options.onProgress?.("Analyzing streaming capture");
  const report = await inspect(options.root ?? "."),
    c = await config(report.root);
  if (
    report.git?.indexEntries
      .split("\0")
      .some((entry) => entry.startsWith("160000 "))
  )
    throw new Error(
      "Submodules require separate complete captures; partial snapshots are refused.",
    );
  for (const prefix of options.exclusions ?? []) {
    safePath(prefix);
    c.exclude = [...(c.exclude ?? []), prefix];
  }
  if (report.git) {
    for (const p of [".git/shallow", ".git/objects/info/alternates"])
      if (await present(path.join(report.root, p)))
        throw new Error(
          "Shallow or externally shared Git objects require a complete standalone repository.",
        );
    await run("git", ["fsck", "--full", "--no-dangling"], report.root);
  }
  const ignored = options.includeIgnored
    ? null
    : await optional(
        "git",
        [
          "ls-files",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--directory",
          "-z",
        ],
        report.root,
      );
  if (ignored)
    c.exclude = [
      ...(c.exclude ?? []),
      ...ignored
        .split("\0")
        .filter(Boolean)
        .map((x) => x.replace(/\/$/, "")),
    ];
  const plannedOutput = path.resolve(options.output ?? ".");
  const relativeOutput = path.relative(report.root, plannedOutput);
  if (
    relativeOutput &&
    !relativeOutput.startsWith("..") &&
    !path.isAbsolute(relativeOutput)
  )
    c.exclude = [
      ...(c.exclude ?? []),
      relativeOutput.split(path.sep).join("/"),
    ];
  const listing = await enumerate(report.root, c, true, options),
    name = options.name ?? path.basename(report.root);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(name))
    throw new Error("Invalid snapshot name");
  if (
    listing.files.some(
      (f) => f.path.endsWith(".promisor") && f.path.startsWith(".git/objects/"),
    )
  )
    throw new Error("Partial clone objects are unsupported");
  const bytes = listing.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  if (
    bytes > V2_LIMITS.total ||
    listing.files.some((f) => (f.size ?? 0) > V2_LIMITS.file)
  )
    throw new Error("Streaming capture size limit exceeded");
  if (options.dryRun) {
    const reviewFiles: SnapshotEntry[] = [],
      reviewOmitted = [...listing.omitted];
    for (const file of listing.files) {
      if (
        file.type === "file" &&
        !options.includeIgnored &&
        !file.path.startsWith(".git/") &&
        (await embeddedSecret(path.join(report.root, file.path), file.size))
      ) {
        reviewOmitted.push(file.path + " (embedded credential detected)");
      } else reviewFiles.push(file);
    }
    return {
      report,
      name,
      capturePolicy: capturePolicy(options),
      warnings: [
        ...(options.includeIgnored ? [IGNORED_CAPTURE_WARNING] : []),
        ...generatedWarnings(options),
      ],
      formatVersion: 2,
      fileCount: reviewFiles.length,
      bytes,
      omitted: reviewOmitted,
      files: reviewFiles.map(({ data, ...f }) => f),
      actions: [
        "Stream saved files into private staging",
        "Hash each payload, encrypt and authenticate format 2",
        "Publish without overwriting",
      ],
    };
  }

  if (!options.password || options.password.length < 12)
    throw new Error("Use an encryption passphrase of at least 12 characters.");
  const output = path.resolve(options.output ?? ".", name + ".dtp");
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (await present(output))
    throw new Error("Snapshot already exists. Choose another name.");
  await available(path.dirname(output), bytes * 2);
  const work = await fs.mkdtemp(
    path.join(path.dirname(output), ".devteleport-v2-"),
  );
  const journal = path.join(work, "journal.json"),
    partial = path.join(
      path.dirname(output),
      "." + name + ".dtp.partial-" + crypto.randomUUID(),
    );
  const payloads: string[] = [],
    files: SnapshotEntry[] = [],
    omitted = [...listing.omitted];
  const fingerprints = new Map<string, string>();
  const fingerprint = (s: import("node:fs").Stats) =>
    JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]);
  try {
    await fs.chmod(work, 0o700);
    await durable(journal, {
      owner: "devteleport",
      pid: process.pid,
      operation: "capture",
      partial,
      status: "enumerated",
      formatVersion: 2,
      output,
      entries: listing.files.length,
    });
    for (const f of listing.files) {
      throwIfCancelled();
      if (f.type !== "file") {
        files.push(f);
        continue;
      }
      options.onProgress?.("Staging " + f.path);
      const source = path.join(report.root, f.path),
        before = await fs.lstat(source);
      if (!before.isFile())
        throw new Error("Source type changed during capture");
      const destination = path.join(work, String(payloads.length));
      let secret = false,
        tail = "";
      const handle = await fs.open(
        source,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      async function* chunks() {
        try {
          for await (const chunk of handle.createReadStream({
            highWaterMark: V2_LIMITS.chunk,
            autoClose: false,
          })) {
            if (!options.includeIgnored && !f.path.startsWith(".git/")) {
              const text = tail + chunk.toString("latin1");
              if (
                /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}/.test(
                  text,
                )
              )
                secret = true;
              tail = text.slice(-256);
            }
            throwIfCancelled();
            yield chunk;
          }
        } finally {
          await handle.close();
        }
      }
      const content = await copyHashed(chunks(), destination, f.size),
        after = await fs.lstat(source);
      if (fingerprint(before) !== fingerprint(after) || content.size !== f.size)
        throw new Error("Workspace changed during capture: " + f.path);
      if (secret) {
        omitted.push(f.path + " (embedded credential detected)");
        await fs.unlink(destination);
        continue;
      }
      files.push({ ...f, ...content });
      payloads.push(destination);
      fingerprints.set(f.path, fingerprint(after));
    }
    if (report.git) await verifyLfsCompleteness(report.root, files);
    const databases: DatabaseRecord[] = [],
      volumes: VolumeRecord[] = [];
    if (options.includeDb) {
      if (!c.databases?.length)
        throw new Error("No databases configured in devteleport.json");
      for (const d of c.databases) {
        options.onProgress?.("Exporting database " + d.name);
        const file = path.join(work, String(payloads.length)),
          metadata = await dumpDatabase(report.root, c, d, file),
          size = (await fs.stat(file)).size;
        if (size > V2_LIMITS.file)
          throw new Error("Database exceeds streaming limit");
        databases.push({
          ...metadata,
          size,
          checksum: await hashFile(file),
          data: "",
        });
        payloads.push(file);
      }
    }
    if (options.includeVolumes) {
      if (!c.volumes?.length) throw new Error("No named volumes configured");
      for (const v of c.volumes) {
        options.onProgress?.("Backing up named volume " + v.name);
        const data = await captureVolume(v.volume),
          file = path.join(work, String(payloads.length));
        await fs.writeFile(file, data, { mode: 0o600, flag: "wx" });
        volumes.push({
          name: v.name,
          format: "docker-local-tar-gzip",
          size: data.length,
          checksum: crypto.createHash("sha256").update(data).digest("hex"),
          data: "",
        });
        payloads.push(file);
      }
    }
    const second = await enumerate(report.root, c, true, options);
    if (
      JSON.stringify(second.files) !== JSON.stringify(listing.files) ||
      report.git?.status !== (await inspect(report.root)).git?.status
    )
      throw new Error(
        "Workspace changed during capture; stop writers and retry.",
      );
    for (const [file, stamp] of fingerprints)
      if (fingerprint(await fs.lstat(path.join(report.root, file))) !== stamp)
        throw new Error("Workspace changed during capture: " + file);
    const m: Manifest = {
      formatVersion: 2,
      capturePolicy: capturePolicy(options),
      name,
      createdAt: new Date().toISOString(),
      platform: report.platform,
      runtime: report.runtime,
      git: report.git,
      services: report.compose.map((file) => ({
        file,
        status: "review before startup",
      })),
      databases,
      volumes,
      editor: { status: "saved workspace/editor files" },
      support: report.support,
      omitted,
      files,
    };
    validateV2(m);
    const metadata = Buffer.from(JSON.stringify(m));
    if (metadata.length > V2_LIMITS.metadata)
      throw new Error("Streaming metadata exceeds limit");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(metadata.length);
    const header = Buffer.concat([
        Buffer.from("DTP2"),
        crypto.randomBytes(16),
        crypto.randomBytes(12),
      ]),
      key = await derive(options.password, header.subarray(4, 20)),
      cipher = crypto.createCipheriv("aes-256-gcm", key, header.subarray(20));
    cipher.setAAD(header);
    await durable(journal, {
      owner: "devteleport",
      pid: process.pid,
      operation: "capture",
      partial,
      status: "encrypting",
      formatVersion: 2,
      output,
      bytes: blobs(m).reduce((sum, b) => sum + b.size, 0),
    });
    options.onProgress?.("Encrypting streaming archive");
    async function* content() {
      yield length;
      yield metadata;
      for (const file of payloads)
        yield* createReadStream(file, { highWaterMark: V2_LIMITS.chunk });
    }
    const stream = createWriteStream(partial, { flags: "wx", mode: 0o600 });
    stream.write(header);
    try {
      await pipeline(Readable.from(content()), cipher, stream);
      await fs.appendFile(partial, cipher.getAuthTag());
      const handle = await fs.open(partial, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } finally {
      key.fill(0);
    }
    throwIfCancelled();
    await publishNoReplace(partial, output);
    await fs.unlink(partial);
    return {
      output,
      capturePolicy: m.capturePolicy,
      warnings: [
        ...(options.includeIgnored ? [IGNORED_CAPTURE_WARNING] : []),
        ...generatedWarnings(options),
      ],
      formatVersion: 2,
      fileCount: files.length,
      bytes: blobs(m).reduce((sum, b) => sum + b.size, 0),
      databases: databases.map((d) => d.name),
      volumes: volumes.map((v) => v.name),
      omitted,
    };
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw error;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
async function authenticate(file: string, password: string | undefined) {
  if (typeof password !== "string")
    throw new Error("Encryption passphrase required");
  const size = (await fs.stat(file)).size;
  if (size < 52 || size > V2_LIMITS.total + V2_LIMITS.metadata + 52)
    throw new Error("Invalid streaming archive size");
  const source = await fs.open(file, "r"),
    header = Buffer.alloc(32),
    tag = Buffer.alloc(16);
  try {
    await source.read(header, 0, 32, 0);
    await source.read(tag, 0, 16, size - 16);
  } finally {
    await source.close();
  }
  if (header.subarray(0, 4).toString() !== "DTP2")
    throw new Error("Unsupported streaming format");
  await available(os.tmpdir(), size);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), ".devteleport-v2-"));
  const payload = path.join(work, "payload");
  let key: Buffer | undefined;
  try {
    await fs.chmod(work, 0o700);
    await durable(path.join(work, "journal.json"), {
      owner: "devteleport",
      pid: process.pid,
      operation: "authenticate",
      formatVersion: 2,
      status: "authenticating",
      archive: file,
    });
    key = await derive(password, header.subarray(4, 20));
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(20),
    );
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    try {
      await pipeline(
        createReadStream(file, {
          start: 32,
          end: size - 17,
          highWaterMark: V2_LIMITS.chunk,
        }),
        decipher,
        createWriteStream(payload, { mode: 0o600, flags: "wx" }),
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOSPC" || code === "EDQUOT")
        throw Object.assign(
          new Error(
            "Cannot stage snapshot authentication: storage is full or its quota was reached. Free disk space and retry; no destination was restored.",
          ),
          { code },
        );
      if (
        ["EACCES", "EPERM", "EROFS", "EIO", "ENOENT", "ENODEV"].includes(
          code ?? "",
        )
      )
        throw Object.assign(
          new Error(
            "Cannot read the snapshot or write private authentication staging. Check storage access, permissions and drive availability, then retry; no destination was restored.",
          ),
          { code },
        );
      throw new Error(
        "Cannot authenticate snapshot: incorrect passphrase or damaged archive.",
      );
    }
    const handle = await fs.open(payload, "r");
    let metadata: Manifest, offset: number;
    try {
      const count = Buffer.alloc(4);
      if ((await handle.read(count, 0, 4, 0)).bytesRead !== 4)
        throw new Error("Truncated metadata");
      const length = count.readUInt32BE();
      if (length < 2 || length > V2_LIMITS.metadata)
        throw new Error("Invalid metadata size");
      const data = Buffer.alloc(length);
      if ((await handle.read(data, 0, length, 4)).bytesRead !== length)
        throw new Error("Truncated metadata");
      metadata = validateV2(JSON.parse(data.toString("utf8")));
      offset = 4 + length;
    } finally {
      await handle.close();
    }
    if (
      (await fs.stat(payload)).size !==
      offset + blobs(metadata).reduce((sum, b) => sum + b.size, 0)
    )
      throw new Error("Streaming payload size mismatch");
    return { work, payload, metadata, offset };
  } catch (error) {
    await fs.rm(work, { recursive: true, force: true });
    throw error;
  } finally {
    key?.fill(0);
  }
}
export async function snapshotMetadata(
  file: string,
  password: string | undefined,
): Promise<Manifest> {
  if (!(await isV2(file))) return readSnapshot(file, password);
  const decoded = await authenticate(file, password);
  try {
    let offset = decoded.offset;
    for (const b of blobs(decoded.metadata)) {
      const hash = await copyHashed(range(decoded.payload, offset, b.size));
      if (hash.checksum !== b.checksum)
        throw new Error("Streaming checksum mismatch");
      offset += b.size;
    }
    return decoded.metadata;
  } finally {
    await fs.rm(decoded.work, { recursive: true, force: true });
  }
}
export async function restoreV2(file: string, options: RestoreOptions) {
  options.onProgress?.("Authenticating entire streaming archive");
  const decoded = await authenticate(file, options.password);
  const m = decoded.metadata,
    target = path.resolve(options.target ?? m.name);
  let stage: string | undefined,
    claimed = false;
  try {
    if (await present(target))
      throw new Error(
        "Destination already exists. Choose a new destination; paths are never overwritten.",
      );
    const warnings =
      m.platform.os !== process.platform ||
      m.platform.architecture !== process.arch
        ? [
            "OS or architecture differs; reinstall native dependencies and review compatibility.",
          ]
        : [];
    if (m.capturePolicy?.includeIgnored) warnings.push(IGNORED_CAPTURE_WARNING);
    warnings.push(...generatedWarnings(m.capturePolicy));
    if (
      options.install &&
      m.files.some((f) => f.path.split("/").includes("node_modules"))
    )
      warnings.push(
        "Dependency installation may replace captured node_modules files and cause verification differences. Leave installation off to preserve the captured dependency files.",
      );
    const tools = await Promise.all(
      [
        ...(m.git ? ["git"] : []),
        ...(options.restoreDb ? ["psql", "pg_restore"] : []),
        ...(options.restoreVolumes ? ["docker"] : []),
      ].map(async (tool) => ({
        tool,
        available:
          (await optional(tool, ["--version"], process.cwd())) !== null,
      })),
    );
    if (tools.some((t) => !t.available))
      warnings.push(
        "Missing or incompatible tools: " +
          tools
            .filter((t) => !t.available)
            .map((t) => t.tool)
            .join(", "),
      );
    const offsets = new Map<string, number>();
    let dependencyOffset = decoded.offset;
    for (const entry of m.files.filter((f) => f.type === "file")) {
      offsets.set(entry.path, dependencyOffset);
      dependencyOffset += entry.size!;
    }
    options.onProgress?.("Checking project requirements");
    const dependencies = await reviewDependencies(m.files, async (entry) => {
      const chunks: Buffer[] = [];
      for await (const chunk of range(
        decoded.payload,
        offsets.get(entry.path)!,
        entry.size!,
      ))
        chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    });
    const plan = {
      dependencies,
      tools,
      databaseDetails: m.databases.map(
        ({ name, serverVersion, toolVersion, size, exclusions }) => ({
          name,
          serverVersion,
          toolVersion,
          bytes: size,
          exclusions,
        }),
      ),
      target,
      capturePolicy: m.capturePolicy ?? { includeIgnored: false },
      formatVersion: 2,
      fileCount: m.files.length,
      bytes: blobs(m).reduce((sum, b) => sum + b.size, 0),
      databases: m.databases.map((d) => d.name),
      volumes: (m.volumes ?? []).map((v) => v.name),
      warnings,
      actions: [
        "Restore authenticated source into a new directory",
        "Execute post-actions only with explicit approvals",
      ],
    };
    if (options.dryRun) {
      let offset = decoded.offset;
      for (const b of blobs(m)) {
        if (
          (await copyHashed(range(decoded.payload, offset, b.size)))
            .checksum !== b.checksum
        )
          throw new Error("Streaming checksum mismatch");
        offset += b.size;
      }
      return plan;
    }
    if (options.install && !options.approveExecution)
      throw new Error("Dependency scripts require --approve-execution");
    if (options.install && dependencies.blockers.length)
      throw new Error(
        "Dependency preflight needs attention: " +
          dependencies.blockers.join(" "),
      );
    if (options.restoreDb && !options.approveDb)
      throw new Error("Database restore requires --approve-db");
    if (options.restoreVolumes && !options.approveVolumes)
      throw new Error("Volume restore requires --approve-volumes");
    if (tools.some((t) => !t.available && t.tool !== "git"))
      throw new Error(
        "Install missing native tools before approved post-restore operations.",
      );
    await fs.mkdir(path.dirname(target), { recursive: true });
    await available(path.dirname(target), plan.bytes);
    stage = await fs.mkdtemp(
      path.join(path.dirname(target), ".devteleport-v2-"),
    );
    await fs.chmod(stage, 0o700);
    await fs.mkdir(path.join(stage, ".devteleport"), { mode: 0o700 });
    await durable(path.join(stage, ".devteleport", "journal.json"), {
      owner: "devteleport",
      pid: process.pid,
      operation: "restore",
      formatVersion: 2,
      status: "restoring",
      target,
    });
    for (const f of m.files
      .filter((f) => f.type === "directory")
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length))
      await fs.mkdir(path.join(stage, f.path), { mode: 0o700 });
    let offset = decoded.offset;
    const componentFiles: string[] = [];
    for (const f of m.files.filter((f) => f.type === "file")) {
      throwIfCancelled();
      options.onProgress?.("Restoring " + f.path);
      const p = path.join(stage, f.path),
        result = await copyHashed(range(decoded.payload, offset, f.size), p);
      if (result.checksum !== f.checksum)
        throw new Error("File checksum mismatch: " + f.path);
      offset += f.size;
      await fs.chmod(p, f.mode);
    }
    for (const b of [...m.databases, ...(m.volumes ?? [])]) {
      const p = path.join(decoded.work, "component-" + componentFiles.length);
      if (
        (await copyHashed(range(decoded.payload, offset, b.size), p))
          .checksum !== b.checksum
      )
        throw new Error("Component checksum mismatch");
      offset += b.size;
      componentFiles.push(p);
    }
    for (const f of m.files.filter((f) => f.type === "symlink"))
      await fs.symlink(f.target, path.join(stage, f.path));
    await fs.mkdir(path.join(stage, ".devteleport"), {
      mode: 0o700,
      recursive: true,
    });
    await durable(path.join(stage, ".devteleport", "inventory.json"), {
      ...m,
      files: m.files.map(({ data, ...f }) => f),
      databases: m.databases.map(({ data, ...d }) => d),
      volumes: (m.volumes ?? []).map(({ data, ...v }) => v),
    });
    await durable(path.join(stage, ".devteleport", "journal.json"), {
      owner: "devteleport",
      pid: process.pid,
      operation: "restore",
      status: "files-staged",
      formatVersion: 2,
      snapshot: m.name,
    });
    for (const f of m.files
      .filter((f) => f.type === "directory")
      .sort((a, b) => b.path.length - a.path.length))
      await fs.chmod(path.join(stage, f.path), f.mode);
    throwIfCancelled();
    await fs.mkdir(target, { mode: 0o700 });
    claimed = true;
    await fs.rename(
      path.join(stage, ".devteleport"),
      path.join(target, ".devteleport"),
    );
    await durable(path.join(target, ".devteleport", "journal.json"), {
      status: "restoring",
      snapshot: m.name,
    });
    for (const name of await fs.readdir(stage))
      await fs.rename(path.join(stage, name), path.join(target, name));
    await fs.rm(stage, { recursive: true, force: true });
    stage = undefined;
    await durable(path.join(target, ".devteleport", "journal.json"), {
      status: "files-restored",
      formatVersion: 2,
      snapshot: m.name,
    });
    claimed = false;
    const postActions: string[] = [];
    if (options.restoreDb || options.restoreVolumes) {
      const c: WorkspaceConfig = JSON.parse(
        await fs.readFile(
          path.resolve(options.dbConfig ?? "devteleport-target.json"),
          "utf8",
        ),
      );
      if (options.restoreDb)
        for (let i = 0; i < m.databases.length; i++) {
          options.onProgress?.("Restoring database " + m.databases[i].name);
          await restoreDatabase(target, c, m.databases[i], componentFiles[i]);
          postActions.push("Database " + m.databases[i].name + " restored");
        }
      if (options.restoreVolumes)
        for (let i = 0; i < (m.volumes ?? []).length; i++) {
          const v = m.volumes![i],
            destination = c.volumes?.find((d) => d.name === v.name);
          if (!destination) throw new Error("Missing trusted volume mapping");
          await restoreVolume(
            destination.volume,
            await fs.readFile(componentFiles[m.databases.length + i]),
          );
          postActions.push("Volume " + v.name + " restored");
        }
    }
    if (options.install) {
      const installation = await installDependencies(
        target,
        dependencies,
        Boolean(options.approveExecution),
        options.onProgress,
        options.onLog,
        options.password ? [options.password] : [],
        { onInstallState: options.onInstallState },
      );
      postActions.push(
        ...installation.completed.map(
          (p) => p.directory + ": " + p.command + " completed",
        ),
      );
    }
    options.onProgress?.("Verifying restored workspace");
    const verification = await verify(target);
    if (!verification.ok)
      throw new Error("Restored workspace verification failed");
    await durable(path.join(target, ".devteleport", "journal.json"), {
      status: "complete",
      formatVersion: 2,
      snapshot: m.name,
      completedAt: new Date().toISOString(),
    });
    return { ...plan, verification, postActions };
  } catch (error) {
    if (claimed) await fs.rm(target, { recursive: true, force: true });
    throw error;
  } finally {
    if (stage) await fs.rm(stage, { recursive: true, force: true });
    await fs.rm(decoded.work, { recursive: true, force: true });
  }
}
