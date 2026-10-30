import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import crypto from "node:crypto";
import { capture, restore } from "../packages/core/index.ts";
import {
  receiveSnapshot,
  sendSnapshot,
  readPairing,
} from "../packages/core/transfer.ts";
import { hashFile } from "../packages/core/stream-v2.ts";
const password = "paired transfer integration passphrase";
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-transfer-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "source");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "a"), "network transfer");
  const a = await capture({
    root,
    name: "network",
    output: temp,
    password,
    format: 2,
  });
  return { temp, root, file: a.output };
}
function call(p, method, url, headers = {}, body = Buffer.alloc(0)) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: p.host,
        port: p.port,
        servername: "devteleport.local",
        ca: p.certificate,
        rejectUnauthorized: true,
        minVersion: "TLSv1.3",
        path: url,
        method,
        headers,
      },
      (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => resolve({ status: res.statusCode, body: text }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
test("real TLS pairing transfers an encrypted snapshot and independently restores it", async (t) => {
  const { temp, root, file } = await fixture(t),
    target = path.join(temp, "received.dtp"),
    pairingFile = path.join(temp, "pair.json");
  const receiver = await receiveSnapshot({
    target,
    pairingFile,
    approve: true,
    timeoutMs: 15000,
  });
  t.after(() => receiver.close());
  const pair = await readPairing(pairingFile);
  assert.equal((await fs.stat(pairingFile)).mode & 0o777, 0o600);
  const unauthorized = await call(pair, "GET", "/status");
  assert.equal(unauthorized.status, 401);
  await assert.rejects(
    sendSnapshot(file, pairingFile, { password, approve: false }),
    /approve-peer/,
  );
  const result = await sendSnapshot(file, pairingFile, {
    password,
    approve: true,
  });
  assert(result.sent);
  await receiver.completion;
  assert.equal(await hashFile(file), await hashFile(target));
  await fs.rm(root, { recursive: true });
  const restored = path.join(temp, "restored");
  assert(
    (await restore(target, { password, target: restored })).verification.ok,
  );
  assert.equal(
    await fs.readFile(path.join(restored, "a"), "utf8"),
    "network transfer",
  );
});
test("an interrupted TLS session resumes from a durable partial file using a new explicit pairing", async (t) => {
  const { temp, file } = await fixture(t),
    target = path.join(temp, "received.dtp"),
    pair1 = path.join(temp, "pair1.json");
  let receiver = await receiveSnapshot({
    target,
    pairingFile: pair1,
    approve: true,
    timeoutMs: 15000,
  });
  const p = await readPairing(pair1),
    bytes = await fs.readFile(file),
    hash = crypto.createHash("sha256").update(bytes).digest("hex"),
    headers = {
      authorization: "Bearer " + p.token,
      "x-snapshot-size": String(bytes.length),
      "x-snapshot-sha256": hash,
    };
  assert.equal((await call(p, "GET", "/status", headers)).status, 200);
  // Exercise an actual dropped HTTPS upload, not a fabricated progress response.
  await new Promise((resolve) => {
    const req = https.request(
      {
        hostname: p.host,
        port: p.port,
        servername: "devteleport.local",
        ca: p.certificate,
        rejectUnauthorized: true,
        minVersion: "TLSv1.3",
        method: "POST",
        path: "/upload",
        headers: {
          ...headers,
          "x-offset": "0",
          "content-length": String(bytes.length),
        },
      },
      () => {},
    );
    req.on("error", () => resolve(undefined));
    req.flushHeaders();
    req.write(bytes.subarray(0, 64), () =>
      setTimeout(() => req.destroy(new Error("test interruption")), 100),
    );
  });
  await new Promise((r) => setTimeout(r, 100));
  await receiver.close();
  const size = (await fs.stat(target + ".transfer.partial")).size;
  assert(size > 0 && size < bytes.length);
  const pair2 = path.join(temp, "pair2.json");
  receiver = await receiveSnapshot({
    target,
    pairingFile: pair2,
    approve: true,
    resume: true,
    timeoutMs: 15000,
  });
  t.after(() => receiver.close());
  const result = await sendSnapshot(file, pair2, { password, approve: true });
  assert.equal(result.resumedAt, size);
  await receiver.completion;
  assert.equal(await hashFile(target), hash);
});
test("receivers require approval, refuse existing paths, expire and reject altered certificate descriptors", async (t) => {
  const { temp, file } = await fixture(t),
    target = path.join(temp, "out.dtp"),
    pairingFile = path.join(temp, "pair.json");
  await assert.rejects(
    receiveSnapshot({ target, pairingFile, approve: false }),
    /approve-receive/,
  );
  await fs.writeFile(target, "existing");
  await assert.rejects(
    receiveSnapshot({ target, pairingFile, approve: true }),
    /already exists/,
  );
  await fs.unlink(target);
  const receiver = await receiveSnapshot({
    target,
    pairingFile,
    approve: true,
    timeoutMs: 1000,
  });
  t.after(() => receiver.close());
  const p = JSON.parse(await fs.readFile(pairingFile, "utf8"));
  p.fingerprint = "wrong";
  await fs.writeFile(pairingFile, JSON.stringify(p));
  await assert.rejects(
    sendSnapshot(file, pairingFile, { approve: true, password }),
    /Invalid or expired/,
  );
  await assert.rejects(receiver.completion, /timed out/);
});
