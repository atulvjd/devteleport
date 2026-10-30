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
]);
const flags = new Set([
  "dry-run",
  "include-db",
  "include-volumes",
  "restore-volumes",
  "approve-volumes",
  "start",
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
      (options as Record<string, string | boolean>)[
        k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      ] = valued.has(k) ? raw[++i] : true;
    } else positional.push(a);
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
    case "inspect":
      result = await inspect(options.root ?? positional[0] ?? ".");
      break;
    case "capture":
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
      result = await recover(positional[0] ?? ".");
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
      await readSnapshot(positional[0], await password());
      await fs.copyFile(
        positional[0],
        options.target,
        fs.constants.COPYFILE_EXCL,
      );
      result = { file: options.target, verified: true };
      break;
    }
    default:
      result = {
        usage:
          "devteleport inspect | capture --name NAME [--dry-run] | restore FILE [--target DIR] [--dry-run] | verify DIR | history [DIR] | services [DIR] | export/import FILE --target FILE",
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
