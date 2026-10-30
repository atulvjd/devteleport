import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
const hash = (bytes: string | Uint8Array) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
async function bounded(file: string, max: number) {
  const st = await fs.stat(file);
  if (st.size > max) throw new Error("Signature input exceeds size limit");
  return fs.readFile(file);
}
export async function generateSigningKeys(prefix: string, password: string) {
  if (password.length < 12)
    throw new Error("Signing key passphrase requires at least 12 characters");
  const keys = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: {
      format: "pem",
      type: "pkcs8",
      cipher: "aes-256-cbc",
      passphrase: password,
    },
  });
  await fs.mkdir(path.dirname(prefix), { recursive: true });
  const privatePath = prefix + ".private.pem",
    publicPath = prefix + ".public.pem";
  const priv = await fs.open(privatePath, "wx", 0o600);
  try {
    await priv.writeFile(keys.privateKey);
    await fs.writeFile(publicPath, keys.publicKey, { flag: "wx", mode: 0o644 });
  } catch (error) {
    await fs.rm(privatePath, { force: true });
    throw error;
  } finally {
    await priv.close();
  }
  return {
    privateKey: privatePath,
    publicKey: publicPath,
    fingerprint: hash(
      crypto
        .createPublicKey(keys.publicKey)
        .export({ format: "der", type: "spki" }),
    ),
  };
}
export async function signSnapshot(
  snapshot: string,
  keyPath: string,
  password: string,
) {
  const bytes = await bounded(snapshot, 128 * 1024 * 1024 + 48);
  if (bytes.subarray(0, 4).toString() !== "DTP1")
    throw new Error("Invalid snapshot format");
  const key = crypto.createPrivateKey({
    key: await bounded(keyPath, 16384),
    format: "pem",
    passphrase: password,
  });
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Only Ed25519 signing keys are supported");
  const snapshotSha256 = hash(bytes);
  const signature = crypto
    .sign(null, Buffer.from("DevTeleport.signature.v1\0" + snapshotSha256), key)
    .toString("base64");
  const file = snapshot + ".sig";
  await fs.writeFile(
    file,
    JSON.stringify({
      formatVersion: 1,
      algorithm: "Ed25519",
      snapshotSha256,
      signature,
    }),
    { flag: "wx", mode: 0o600 },
  );
  return { signature: file, snapshotSha256 };
}
export async function verifySignature(snapshot: string, publicPath: string) {
  const key = crypto.createPublicKey(await bounded(publicPath, 16384));
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Only Ed25519 public keys are supported");
  const metadata = JSON.parse(
    (await bounded(snapshot + ".sig", 8192)).toString("utf8"),
  );
  const digest = hash(await bounded(snapshot, 128 * 1024 * 1024 + 48));
  if (
    metadata.formatVersion !== 1 ||
    metadata.algorithm !== "Ed25519" ||
    metadata.snapshotSha256 !== digest ||
    typeof metadata.signature !== "string" ||
    !crypto.verify(
      null,
      Buffer.from("DevTeleport.signature.v1\0" + digest),
      key,
      Buffer.from(metadata.signature, "base64"),
    )
  )
    throw new Error("Snapshot signature verification failed");
  return {
    verified: true,
    fingerprint: hash(key.export({ format: "der", type: "spki" })),
    snapshotSha256: digest,
  };
}
