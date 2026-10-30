#!/usr/bin/env node
import type {
  CaptureOptions,
  CliOptions,
  RestoreOptions,
} from "../../packages/core/types.ts";
import {
  inspect,
  capture,
  restore,
  verify,
  history,
  composePlan,
  startServices,
  recover,
  verifyFromSnapshot,
} from "../../packages/core/index.ts";
import {
  generateSigningKeys,
  signSnapshot,
  verifySignature,
} from "../../packages/core/signatures.ts";
import { snapshotMetadata } from "../../packages/core/stream-v2.ts";
import {
  receiveSnapshot,
  sendSnapshot,
  readPairing,
} from "../../packages/core/transfer.ts";
import { diagnostics } from "../../packages/core/platform.ts";
import { shutdownChildren } from "../../packages/core/processes.ts";
import { cleanupRecovery } from "../../packages/core/recovery.ts";
import * as fs from "node:fs/promises";
import readline from "node:readline";
import { Writable } from "node:stream";
async function password(): Promise<string> {
  if (process.env.DEVTELEPORT_PASSWORD) return process.env.DEVTELEPORT_PASSWORD;
  if (!process.stdin.isTTY)
    throw new Error("Set DEVTELEPORT_PASSWORD in noninteractive use.");
  process.stderr.write("Snapshot passphrase (hidden): ");
  const sink = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: sink,
    terminal: true,
  });
  return new Promise<string>((resolve) =>
    rl.question("", (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    }),
  );
}
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    shutdownChildren().finally(() => process.exit(130));
  });
const raw = process.argv.slice(2),
  command = raw.shift(),
  options: CliOptions = {},
  positional = [];
const valued = new Set([
  "name",
  "output",
  "target",
  "root",
  "db-config",
  "snapshot",
  "key",
  "verify-key",
  "format",
  "cleanup",
  "exclude",
  "pairing",
  "pairing-output",
  "bind",
  "advertise",
  "port",
  "timeout",
]);
const flags = new Set([
  "dry-run",
  "include-db",
  "include-volumes",
  "restore-volumes",
  "approve-volumes",
  "start",
  "approve-cleanup",
  "approve-receive",
  "approve-peer",
  "resume",
  "restore-db",
  "install",
  "approve-execution",
  "approve-db",
]);
try {
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (!valued.has(k) && !flags.has(k))
        throw new Error(`Unknown option: ${a}`);
      if (valued.has(k) && (!raw[i + 1] || raw[i + 1].startsWith("--")))
        throw new Error(`Missing value: ${a}`);
      if (k === "exclude") {
        options.exclusions ??= [];
        options.exclusions.push(raw[++i]);
        continue;
      }
      (options as Record<string, string | boolean>)[
        k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      ] = valued.has(k) ? raw[++i] : true;
    } else positional.push(a);
  }
  if(process.env.DEVTELEPORT_PROGRESS==="1"){let last=0;options.onProgress=phase=>{const now=Date.now();if(now-last<100&&(phase.startsWith("Staging ")||phase.startsWith("Restoring ")))return;last=now;process.stderr.write("DTP_PROGRESS:"+JSON.stringify({phase})+"\n");};}
  if (options.format !== undefined) {
    const format = Number(options.format);
    if (format !== 1 && format !== 2)
      throw new Error("--format must be 1 or 2");
    options.format = format;
  }
  let result;
  switch (command) {
    case "keygen":
      if (!options.target) throw new Error("Provide --target key prefix");
      result = await generateSigningKeys(options.target, await password());
      break;
    case "sign":
      if (!positional[0] || !options["key"])
        throw new Error("Provide snapshot and --key encrypted-private.pem");
      result = await signSnapshot(
        positional[0],
        options["key"],
        await password(),
      );
      break;
    case "check-signature":
      if (!positional[0] || !options["key"])
        throw new Error("Provide snapshot and --key trusted-public.pem");
      result = await verifySignature(positional[0], options["key"]);
      break;
    case "snapshot-info":
      if (!positional[0]) throw new Error("Provide a snapshot path");
      {
        const metadata = await snapshotMetadata(
          positional[0],
          await password(),
        );
        result = {
          ...metadata,
          files: metadata.files.map(({ data, ...f }) => f),
          databases: metadata.databases.map(({ data, ...d }) => d),
          volumes: (metadata.volumes ?? []).map(({ data, ...v }) => v),
        };
      }
      break;
    case "pairing-info":
      if (!options.pairing)
        throw new Error("Provide --pairing descriptor.json");
      {
        const pairing = await readPairing(options.pairing);
        result = {
          receiver: pairing.receiver,
          host: pairing.host,
          port: pairing.port,
          fingerprint: pairing.fingerprint,
          expiresAt: pairing.expiresAt,
        };
      }
      break;
    case "receive":
      if (!options.target || !options.pairingOutput)
        throw new Error(
          "Provide --target new-snapshot.dtp and --pairing-output descriptor.json",
        );
      {
        const receiver = await receiveSnapshot({
          target: options.target,
          pairingFile: options.pairingOutput,
          approve: Boolean(options.approveReceive),
          bind: options.bind,
          advertise: options.advertise,
          port: options.port ? Number(options.port) : undefined,
          timeoutMs: options.timeout
            ? Number(options.timeout) * 1000
            : undefined,
          resume: options.resume,
          onReady: (ready) =>
            process.stderr.write(
              "DTP_PROGRESS:" +
                JSON.stringify({
                  phase:
                    "Receiver ready; share the protected pairing descriptor out of band",
                  ready,
                }) +
                "\n",
            ),
        });
        try {
          result = await receiver.completion;
        } finally {
          await receiver.close();
        }
      }
      break;
    case "send":
      if (!positional[0] || !options.pairing)
        throw new Error("Provide a snapshot and --pairing descriptor.json");
      {
        let last = 0;
        result = await sendSnapshot(positional[0], options.pairing, {
          approve: Boolean(options.approvePeer),
          password: await password(),
          onProgress: (bytes) => {
            if (Date.now() - last > 200) {
              options.onProgress?.("Transferred " + bytes + " bytes");
              last = Date.now();
            }
          },
        });
      }
      break;
    case "diagnostics":
      result = await diagnostics();
      break;
    case "inspect":
      result = await inspect(options.root ?? positional[0] ?? ".");
      break;
    case "capture":
      options.format ??= 2;
      if (!options.dryRun) {
        const review = await capture({ ...options, dryRun: true });
        process.stderr.write(
          JSON.stringify(
            {
              root: review.report?.root,
              fileCount: review.fileCount,
              omitted: review.omitted,
            },
            null,
            2,
          ) + "\n",
        );
        options.password = await password();
      }
      result = await capture(options);
      break;
    case "restore":
      if (options["verifyKey"])
        await verifySignature(positional[0], options["verifyKey"]);
      if (!positional[0]) throw new Error("Provide a snapshot path");
      result = await restore(positional[0], {
        ...options,
        password: await password(),
      });
      break;
    case "verify":
      result = options["snapshot"]
        ? await verifyFromSnapshot(
            positional[0] ?? ".",
            options["snapshot"],
            await password(),
          )
        : await verify(positional[0] ?? ".");
      if (!result.ok) process.exitCode = 2;
      break;
    case "recover":
      result = options.cleanup
        ? await cleanupRecovery(
            options.cleanup,
            Boolean(options.approveCleanup),
          )
        : await recover(positional[0] ?? ".");
      break;
    case "history":
      result = await history(positional[0] ?? ".");
      break;
    case "services":
      result = options["start"]
        ? await startServices(
            options.root ?? positional[0] ?? ".",
            options.approveExecution,
          )
        : await composePlan(options.root ?? positional[0] ?? ".");
      break;
    case "export":
    case "import": {
      if (!positional[0] || !options.target)
        throw new Error("Provide a snapshot and --target destination.dtp");
      const { readSnapshot } = await import("../../packages/core/index.ts");
      await snapshotMetadata(positional[0], await password());
      await fs.copyFile(
        positional[0],
        options.target,
        fs.constants.COPYFILE_EXCL,
      );
      result = { file: options.target, verified: true };
      break;
    }
    default:
      if (command && command !== "help" && command !== "--help")
        throw new Error("Unknown command: " + command);
      result = {
        usage:
          "devteleport inspect | capture --name NAME [--include-db] [--include-volumes] [--dry-run] | restore FILE --target DIR [--dry-run] | verify DIR [--snapshot FILE] | recover DIR | history DIR | services DIR [--start --approve-execution] | export/import FILE --target FILE | keygen --target PREFIX | sign FILE --key PRIVATE | check-signature FILE --key PUBLIC",
        security:
          "Encrypted snapshots require a passphrase. Never put passphrases in command arguments. Use interactive input or DEVTELEPORT_PASSWORD.",
        database:
          "capture --include-db; restore --restore-db --approve-db --db-config TRUSTED_CONFIG",
        install:
          "restore --install --approve-execution permits npm lifecycle scripts",
      };
  }
  console.log(JSON.stringify(result, null, 2));
} catch (caught) {
  const e = caught as NodeJS.ErrnoException;
  const message =
    e.code === "EACCES" || e.code === "EPERM"
      ? "Could not access the selected path. Check its permissions or choose another location."
      : e.code === "ENOENT"
        ? "The selected file or directory does not exist. Check the path and try again."
        : e.message;
  console.error(`DevTeleport: ${message}`);
  process.exitCode = 1;
}
