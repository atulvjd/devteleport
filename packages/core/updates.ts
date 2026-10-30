import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs/promises";
interface Release {
  version: string;
  channel: "stable";
  notes: string;
  artifacts: {
    architecture: "arm64" | "x64";
    platform: "darwin";
    url: string;
    sha256: string;
  }[];
}
export function validateRelease(
  bytes: Buffer,
  signature: Buffer,
  publicKey: string,
  currentVersion: string,
) {
  const key = crypto.createPublicKey(publicKey);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !crypto.verify(null, bytes, key, signature)
  )
    throw new Error("Release manifest signature verification failed");
  if (bytes.length > 65536) throw new Error("Release manifest exceeds limit");
  const release = JSON.parse(bytes.toString("utf8")) as Release;
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (
    !version.test(release.version) ||
    !version.test(currentVersion) ||
    release.channel !== "stable" ||
    typeof release.notes !== "string" ||
    release.notes.length > 16000 ||
    !Array.isArray(release.artifacts) ||
    release.artifacts.length > 8
  )
    throw new Error("Invalid release metadata");
  for (const a of release.artifacts) {
    const url = new URL(a.url);
    if (
      a.platform !== "darwin" ||
      !["arm64", "x64"].includes(a.architecture) ||
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !["github.com", "release-assets.githubusercontent.com"].includes(
        url.hostname,
      )
    )
      throw new Error("Untrusted release artifact source");
  }
  const a = release.version.split(".").map(Number),
    b = currentVersion.split(".").map(Number);
  let newer = false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      newer = a[i] > b[i];
      break;
    }
  }
  return {
    state: newer ? "available" : "current",
    release,
    installation:
      "BLOCKED: signed/notarized distribution and signed application update verification must be configured before enabling installation.",
  };
}
async function get(url: string, ca?: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error(
      "Update metadata requires HTTPS without embedded credentials",
    );
  return new Promise((resolve, reject) => {
    const request = https.get(
      parsed,
      {
        ca,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        headers: {
          "user-agent": "DevTeleport update checker",
          accept: "application/octet-stream",
        },
        timeout: 15000,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error("Release source returned HTTP " + response.statusCode),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 65536)
            response.destroy(new Error("Update response exceeds limit"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("Update check timed out")),
    );
    request.on("error", reject);
  });
}
export async function checkSignedRelease(options: {
  manifestUrl?: string;
  signatureUrl?: string;
  publicKeyPath?: string;
  currentVersion: string;
  ca?: string;
}) {
  if (!options.manifestUrl || !options.signatureUrl || !options.publicKeyPath)
    return {
      state: "disabled",
      reason:
        "No trusted release key/feed configured. Automatic executable updates remain disabled.",
    };
  for (const source of [options.manifestUrl, options.signatureUrl]) {
    const u = new URL(source);
    if (
      !options.ca &&
      ![
        "github.com",
        "raw.githubusercontent.com",
        "api.github.com",
        "release-assets.githubusercontent.com",
      ].includes(u.hostname)
    )
      throw new Error("Update feed is outside approved release sources");
  }
  if ((await fs.stat(options.publicKeyPath)).size > 16384)
    throw new Error("Release public key exceeds limit");
  const key = await fs.readFile(options.publicKeyPath, "utf8");
  if (key.length > 16384) throw new Error("Release public key exceeds limit");
  const [manifest, signature] = await Promise.all([
    get(options.manifestUrl, options.ca),
    get(options.signatureUrl, options.ca),
  ]);
  return validateRelease(
    manifest,
    Buffer.from(signature.toString("utf8").trim(), "base64"),
    key,
    options.currentVersion,
  );
}
