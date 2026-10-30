import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  capture,
  restore,
  verify,
  verifyFromSnapshot,
  recover,
} from "../packages/core/index.ts";
import {
  generateSigningKeys,
  signSnapshot,
  verifySignature,
} from "../packages/core/signatures.ts";
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-hardening-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  return { temp, root };
}
const password = "security integration password";
test("embedded credentials and additional credential directories excluded with review records", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(
    path.join(root, "innocent.txt"),
    "-----BEGIN PRIVATE KEY-----\nexample",
  );
  await fs.mkdir(path.join(root, ".docker"));
  await fs.writeFile(path.join(root, ".docker", "config.json"), "secret");
  const result = await capture({
    root,
    name: "secrets",
    output: temp,
    password,
  });
  assert(result.omitted.some((x) => x.startsWith("innocent.txt")));
  assert(result.omitted.includes(".docker"));
});
test("authenticated archive verification detects forged local inventory; publication and recovery journal", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "source");
  const a = await capture({ root, name: "auth", output: temp, password });
  assert(!(await recover(temp)).entries.length);
  const target = path.join(temp, "target");
  await restore(a.output, { target, password });
  assert.equal((await recover(target)).entries[0].status, "complete");
  await fs.writeFile(path.join(target, "a"), "changed");
  const inventory = path.join(target, ".devteleport", "inventory.json");
  const m = JSON.parse(await fs.readFile(inventory, "utf8"));
  m.files = [];
  await fs.writeFile(inventory, JSON.stringify(m));
  assert((await verify(target)).ok);
  assert(!(await verifyFromSnapshot(target, a.output, password)).ok);
  await fs.writeFile(
    path.join(temp, ".auth.dtp.partial-example"),
    "incomplete",
  );
  assert.equal((await recover(temp)).entries.length, 1);
});
test("Ed25519 signature validates trusted key and rejects archive tampering and wrong signers", async (t) => {
  const { root, temp } = await fixture(t);
  await fs.writeFile(path.join(root, "a"), "signed");
  const a = await capture({ root, name: "signed", output: temp, password });
  const keys = await generateSigningKeys(path.join(temp, "signer"), password);
  await signSnapshot(a.output, keys.privateKey, password);
  assert((await verifySignature(a.output, keys.publicKey)).verified);
  const other = await generateSigningKeys(path.join(temp, "other"), password);
  await assert.rejects(
    verifySignature(a.output, other.publicKey),
    /verification failed/,
  );
  const bytes = await fs.readFile(a.output);
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(a.output, bytes);
  await assert.rejects(
    verifySignature(a.output, keys.publicKey),
    /verification failed/,
  );
});
test("malformed or unknown configuration is refused", async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(
    path.join(root, "devteleport.json"),
    JSON.stringify({
      databases: [
        { name: "app", connectionEnv: "DTP", password: "must-not-embed" },
      ],
    }),
  );
  await assert.rejects(
    capture({ root, dryRun: true }),
    /Unknown adapter field/,
  );
});
