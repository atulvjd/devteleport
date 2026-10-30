import {publishNoReplace} from "./atomic.ts";
import { execText, trackChild, registerCleanup } from "./processes.ts";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream, constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { hashFile, snapshotMetadata, V2_LIMITS } from "./stream-v2.ts";
const exec = execText,
  MAX = V2_LIMITS.total + V2_LIMITS.metadata + 52;
interface Pairing {
  version: 1;
  host: string;
  port: number;
  certificate: string;
  fingerprint: string;
  token: string;
  receiver: string;
  expiresAt: string;
}
const fingerprint = (pem: string) =>
  new crypto.X509Certificate(pem).fingerprint256;
async function exists(file: string) {
  try {
    await fs.lstat(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
async function stateWrite(file: string, value: unknown) {
  const temp = file + ".tmp-" + crypto.randomUUID(),
    handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}
export async function readPairing(file: string): Promise<Pairing> {
  const st = await fs.stat(file);
  if (st.size > 16384) throw new Error("Pairing descriptor too large");
  const p = JSON.parse(await fs.readFile(file, "utf8")) as Pairing;
  if (
    p.version !== 1 ||
    typeof p.host !== "string" ||
    !p.host ||
    !Number.isInteger(p.port) ||
    p.port < 1 ||
    p.port > 65535 ||
    typeof p.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(p.token) ||
    typeof p.certificate !== "string" ||
    p.certificate.length > 12000 ||
    fingerprint(p.certificate) !== p.fingerprint ||
    !Number.isFinite(Date.parse(p.expiresAt)) ||
    Date.parse(p.expiresAt) < Date.now()
  )
    throw new Error("Invalid or expired pairing descriptor");
  return p;
}
export async function receiveSnapshot(options: {
  target: string;
  pairingFile: string;
  approve: boolean;
  bind?: string;
  advertise?: string;
  port?: number;
  resume?: boolean;
  timeoutMs?: number;
  onReady?: (ready: object) => void;
}) {
  if (!options.approve)
    throw new Error(
      "Receiving requires explicit --approve-receive and a selected destination.",
    );
  const target = path.resolve(options.target),
    pairingFile = path.resolve(options.pairingFile);
  if (await exists(target))
    throw new Error("Destination already exists; receiving never overwrites.");
  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = target + ".transfer.partial",
    journal = partial + ".json";
  if ([target, partial, journal].includes(pairingFile))
    throw new Error(
      "Pairing descriptor and snapshot/recovery paths must be distinct",
    );
  if (options.bind === "0.0.0.0" && !options.advertise)
    throw new Error(
      "Provide an advertised LAN IP or hostname when listening on all interfaces",
    );
  await fs.mkdir(path.dirname(pairingFile), { recursive: true });
  if (!options.resume && ((await exists(partial)) || (await exists(journal))))
    throw new Error(
      "Interrupted transfer exists; use --resume or a new destination.",
    );
  if (options.resume) {
    for (const file of [partial, journal])
      if ((await exists(file)) && !(await fs.lstat(file)).isFile())
        throw new Error("Unsafe resume path");
  }
  if (await exists(pairingFile))
    throw new Error(
      "Pairing output already exists; choose a new descriptor path.",
    );
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "devteleport-pairing-"));
  await fs.chmod(temp, 0o700);
  const keyFile = path.join(temp, "key.pem"),
    certFile = path.join(temp, "cert.pem"),
    config = path.join(temp, "openssl.cnf");
  await fs.writeFile(
    config,
    "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=extensions\n[dn]\nCN=devteleport.local\n[extensions]\nsubjectAltName=DNS:devteleport.local\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyCertSign\nextendedKeyUsage=serverAuth\n",
    { mode: 0o600 },
  );
  try {
    await exec(
      "openssl",
      [
        "req",
        "-new",
        "-x509",
        "-newkey",
        "rsa:3072",
        "-nodes",
        "-days",
        "1",
        "-config",
        config,
        "-keyout",
        keyFile,
        "-out",
        certFile,
      ],
      { timeout: 30000, maxBuffer: 65536 },
    );
  } catch {
    await fs.rm(temp, { recursive: true, force: true });
    throw new Error(
      "OpenSSL certificate generation failed. Configure a compatible local OpenSSL executable.",
    );
  }
  await fs.chmod(keyFile, 0o600);
  const certificate = await fs.readFile(certFile, "utf8"),
    token = crypto.randomBytes(32).toString("hex"),
    timeout = Math.min(3600000, Math.max(1000, options.timeoutMs ?? 900000));
  let busy = false,
    settled = false;
  let resolveCompletion: (v: object) => void = () => {},
    rejectCompletion: (e: Error) => void = () => {};
  const completion = new Promise<object>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  completion.catch(() => {});
  const sockets = new Set<import("node:net").Socket>();
  const server = https.createServer(
    {
      key: await fs.readFile(keyFile),
      cert: certificate,
      minVersion: "TLSv1.3",
      maxHeaderSize: 8192,
      handshakeTimeout: 10000,
    },
    async (req, res) => {
      const authorization = req.headers.authorization ?? "";
      const expected = "Bearer " + token;
      if (
        authorization.length !== expected.length ||
        !crypto.timingSafeEqual(
          Buffer.from(authorization),
          Buffer.from(expected),
        )
      ) {
        res.writeHead(401).end("Pairing approval required");
        req.resume();
        return;
      }
      if (busy) {
        res.writeHead(409).end("Another transfer is active");
        return;
      }
      const size = Number(req.headers["x-snapshot-size"]),
        hash = req.headers["x-snapshot-sha256"];
      if (
        !Number.isSafeInteger(size) ||
        size < 48 ||
        size > MAX ||
        typeof hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(hash)
      ) {
        res.writeHead(400).end("Invalid transfer metadata");
        return;
      }
      busy = true;
      try {
        let metadata: { size: number; hash: string } | undefined;
        if (await exists(journal))
          metadata = JSON.parse(await fs.readFile(journal, "utf8"));
        if (metadata && (metadata.hash !== hash || metadata.size !== size))
          throw new Error(
            "Resume metadata mismatch; select a new destination.",
          );
        if (!metadata) {
          if (await exists(partial))
            throw new Error("Unowned partial file; select a new destination.");
          await stateWrite(journal, { size, hash, status: "receiving" });
          const handle = await fs.open(partial, "wx", 0o600);
          await handle.close();
        }
        const offset = (await fs.stat(partial)).size;
        const space = await fs.statfs(path.dirname(target));
        if (
          Number(space.bavail) * Number(space.bsize) <
          size - offset + 64 * 1024 ** 2
        )
          throw new Error(
            "Insufficient receiver storage for approved transfer.",
          );
        if (offset > size) throw new Error("Invalid partial transfer size");
        if (req.method === "GET" && req.url === "/status") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ offset, size, receiver: os.hostname() }));
          return;
        }
        if (
          req.method !== "POST" ||
          req.url !== "/upload" ||
          Number(req.headers["x-offset"]) !== offset ||
          Number(req.headers["content-length"]) !== size - offset
        ) {
          res.writeHead(409).end("Invalid transfer offset or length");
          return;
        }
        let count = offset;
        const limiter = new Transform({
          transform(chunk, encoding, callback) {
            count += chunk.length;
            callback(
              count > size ? new Error("Transfer exceeds approved size") : null,
              chunk,
            );
          },
        });
        const handle = await fs.open(
          partial,
          constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
        );
        try {
          await pipeline(
            req,
            limiter,
            createWriteStream(partial, { fd: handle.fd, autoClose: false }),
          );
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (count !== size || (await hashFile(partial)) !== hash)
          throw new Error(
            "Transfer size/checksum mismatch; partial retained for inspection.",
          );
        const magic = Buffer.alloc(4),
          input = await fs.open(partial, "r");
        try {
          await input.read(magic, 0, 4, 0);
        } finally {
          await input.close();
        }
        if (!["DTP1", "DTP2"].includes(magic.toString()))
          throw new Error(
            "Received file is not a supported DevTeleport snapshot",
          );
        await publishNoReplace(partial, target);
        await fs.unlink(partial);
        await stateWrite(journal, {
          size,
          hash,
          status: "complete",
          target,
          completedAt: new Date().toISOString(),
        });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ received: true, bytes: size, sha256: hash }));
        settled = true;
        resolveCompletion({ target, bytes: size, sha256: hash });
        setImmediate(() => server.close());
      } catch (error) {
        if (!res.headersSent) res.writeHead(409);
        if (!res.destroyed) res.end((error as Error).message);
      } finally {
        busy = false;
      }
    },
  );
  server.maxConnections = 4;
  server.headersTimeout = 10000;
  server.requestTimeout = timeout;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.setTimeout(30000, () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
  });
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCompletion(
        new Error(
          "Receiver timed out; partial transfer retained for explicit resume.",
        ),
      );
    }
    for (const socket of sockets) socket.destroy();
    server.close();
  }, timeout);
  const close = async () => {
    clearTimeout(timer);
    if (!settled) {
      settled = true;
      rejectCompletion(
        new Error("Receiver stopped; partial retained for resume."),
      );
    }
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(temp, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, options.bind ?? "127.0.0.1", () =>
        resolve(),
      );
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Receiver did not bind");
    const pairing: Pairing = {
      version: 1,
      host:
        options.advertise ??
        (options.bind === "0.0.0.0"
          ? os.hostname()
          : (options.bind ?? "127.0.0.1")),
      port: address.port,
      certificate,
      fingerprint: fingerprint(certificate),
      token,
      receiver: os.hostname(),
      expiresAt: new Date(Date.now() + timeout).toISOString(),
    };
    await fs.writeFile(pairingFile, JSON.stringify(pairing, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    options.onReady?.({
      pairingFile,
      fingerprint: pairing.fingerprint,
      receiver: pairing.receiver,
      host: pairing.host,
      port: pairing.port,
      expiresAt: pairing.expiresAt,
    });
    completion
      .finally(() => {
        clearTimeout(timer);
        server.close();
        fs.rm(temp, { recursive: true, force: true }).catch(() => {});
      })
      .catch(() => {});
    return { completion, close, pairingFile, fingerprint: pairing.fingerprint };
  } catch (error) {
    await close();
    throw error;
  }
}
async function request(
  pairing: Pairing,
  method: string,
  route: string,
  headers: Record<string, string>,
  file?: string,
  offset = 0,
  onProgress?: (bytes: number) => void,
): Promise<{ offset?: number; received?: boolean }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: pairing.host,
        port: pairing.port,
        servername: "devteleport.local",
        ca: pairing.certificate,
        rejectUnauthorized: true,
        minVersion: "TLSv1.3",
        method,
        path: route,
        headers: { ...headers, authorization: "Bearer " + pairing.token },
        timeout: 30000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 65536)
            res.destroy(new Error("Invalid receiver response"));
        });
        res.on("error", reject);
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error("Receiver refused transfer: " + body.slice(0, 1000)),
            );
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Invalid receiver response"));
          }
        });
      },
    );
    req.on("timeout", () =>
      req.destroy(
        new Error(
          "Transfer connection timed out; retry with the same pairing descriptor to resume.",
        ),
      ),
    );
    req.on("error", reject);
    if (file) {
      const stream = createReadStream(file, {
        start: offset,
        highWaterMark: 256 * 1024,
      });
      let bytes = offset;
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        onProgress?.(bytes);
      });
      stream.on("error", (error) => req.destroy(error));
      req.on("error", () => stream.destroy());
      req.on("close", () => stream.destroy());
      stream.pipe(req);
    } else req.end();
  });
}
export async function sendSnapshot(
  file: string,
  pairingFile: string,
  options: {
    approve: boolean;
    password?: string;
    onProgress?: (bytes: number) => void;
  },
) {
  if (!options.approve)
    throw new Error(
      "Review the receiving device fingerprint and pass --approve-peer to authorize transfer.",
    );
  const pairing = await readPairing(pairingFile);
  await snapshotMetadata(file, options.password);
  const size = (await fs.stat(file)).size,
    sha256 = await hashFile(file),
    headers = { "x-snapshot-size": String(size), "x-snapshot-sha256": sha256 };
  const status = await request(pairing, "GET", "/status", headers);
  const offset = status.offset;
  if (!Number.isSafeInteger(offset) || offset! < 0 || offset! > size)
    throw new Error("Invalid receiver offset");
  const result = await request(
    pairing,
    "POST",
    "/upload",
    {
      ...headers,
      "x-offset": String(offset),
      "content-length": String(size - offset!),
    },
    file,
    offset,
    options.onProgress,
  );
  if (!result.received) throw new Error("Receiver did not confirm integrity");
  return {
    sent: true,
    bytes: size,
    resumedAt: offset,
    sha256,
    receiver: pairing.receiver,
    fingerprint: pairing.fingerprint,
  };
}
