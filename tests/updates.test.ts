import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  validateRelease,
  checkSignedRelease,
} from "../packages/core/updates.ts";
test("signed stable release version checks reject modified manifests, wrong keys and untrusted artifact URLs", async () => {
  const key = crypto.generateKeyPairSync("ed25519"),
    publicKey = key.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    manifest = {
      version: "0.2.0",
      channel: "stable",
      notes: "Streaming snapshots",
      artifacts: [
        {
          platform: "darwin",
          architecture: "arm64",
          url: "https://github.com/atulvjd/devteleport/releases/download/v0.2.0/DevTeleport.zip",
          sha256: "a".repeat(64),
        },
      ],
    },
    bytes = Buffer.from(JSON.stringify(manifest)),
    signature = crypto.sign(null, bytes, key.privateKey);
  assert.equal(
    validateRelease(bytes, signature, publicKey, "0.1.0").state,
    "available",
  );
  assert.equal(
    validateRelease(bytes, signature, publicKey, "0.2.0").state,
    "current",
  );
  const changed = Buffer.from(
    JSON.stringify({ ...manifest, version: "9.0.0" }),
  );
  assert.throws(
    () => validateRelease(changed, signature, publicKey, "0.1.0"),
    /signature/,
  );
  const malicious = Buffer.from(
    JSON.stringify({
      ...manifest,
      artifacts: [
        { ...manifest.artifacts[0], url: "https://evil.example/app.zip" },
      ],
    }),
  );
  assert.throws(
    () =>
      validateRelease(
        malicious,
        crypto.sign(null, malicious, key.privateKey),
        publicKey,
        "0.1.0",
      ),
    /Untrusted/,
  );
  assert.equal(
    (await checkSignedRelease({ currentVersion: "0.1.0" })).state,
    "disabled",
  );
});
