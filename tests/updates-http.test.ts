import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { checkSignedRelease } from "../packages/core/updates.ts";
test("real HTTPS update infrastructure validates a signed release and rejects modified metadata", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-update-tls-"));
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  });
  const config = path.join(temp, "openssl.cnf");
  await fs.writeFile(
    config,
    "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=DNS:localhost\nbasicConstraints=critical,CA:TRUE\n",
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-new",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-days",
      "1",
      "-config",
      config,
      "-keyout",
      path.join(temp, "key.pem"),
      "-out",
      path.join(temp, "cert.pem"),
    ],
    { stdio: "pipe" },
  );
  const key = crypto.generateKeyPairSync("ed25519"),
    publicPath = path.join(temp, "release.pub.pem");
  await fs.writeFile(
    publicPath,
    key.publicKey.export({ type: "spki", format: "pem" }),
  );
  let bytes = Buffer.from(
    JSON.stringify({
      version: "0.2.0",
      channel: "stable",
      notes: "Native streaming release",
      artifacts: [
        {
          platform: "darwin",
          architecture: "arm64",
          url: "https://github.com/atulvjd/devteleport/releases/download/v0.2.0/DevTeleport.zip",
          sha256: "b".repeat(64),
        },
      ],
    }),
  );
  const signature = crypto.sign(null, bytes, key.privateKey).toString("base64"),
    certificate = await fs.readFile(path.join(temp, "cert.pem"), "utf8");
  server = https.createServer(
    {
      key: await fs.readFile(path.join(temp, "key.pem")),
      cert: certificate,
      minVersion: "TLSv1.2",
    },
    (req, res) => res.end(req.url === "/signature" ? signature : bytes),
  );
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  const port = server.address().port,
    options = {
      currentVersion: "0.1.0",
      manifestUrl: `https://localhost:${port}/manifest`,
      signatureUrl: `https://localhost:${port}/signature`,
      publicKeyPath: publicPath,
      ca: certificate,
    };
  assert.equal((await checkSignedRelease(options)).state, "available");
  bytes = Buffer.from(bytes.toString().replace("0.2.0", "9.9.9"));
  await assert.rejects(checkSignedRelease(options), /signature verification/);
  await assert.rejects(
    checkSignedRelease({ ...options, ca: undefined }),
    /outside approved/,
  );
});
