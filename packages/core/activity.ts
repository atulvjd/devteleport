import { StringDecoder } from "node:string_decoder";

export type ActivityOutput = { stream: "stdout" | "stderr" | "system"; text: string };
export function activitySecrets(env: NodeJS.ProcessEnv = process.env, extra: string[] = []) {
  return [...new Set([...extra, ...Object.entries(env).filter(([key]) => /password|passphrase|secret|token|credential|api_?key|database_?url|connection_?string|(?:^|_)dsn$/i.test(key)).map(([, value]) => value || "")])]
    .flatMap((value) => value.split(/\r?\n/)).filter((value) => value.length >= 4).sort((a, b) => b.length - a.length);
}

/** Best-effort display filtering, not a universal secret detector or sandbox. */
export function redactActivityText(value: unknown, secrets: string[] = []): string {
  let text = String(value ?? "").slice(0, 256 * 1024)
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  for (const secret of secrets) if (secret) text = text.split(secret).join("[REDACTED]");
  text = text
    .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:[a-z][a-z0-9+.-]*):\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/([?&][a-zA-Z0-9_.%-]+=)[^\s&#"']+/g, "$1[REDACTED]")
    .replace(/((?:[\w.-]*(?:password|passwd|passphrase|token|secret|api[_-]?key|credential|_auth)[\w.-]*|database_url|connection_string|dsn)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/\b(?:npm_[a-zA-Z0-9]{12,}|gh[pousr]_[a-zA-Z0-9]{12,}|github_pat_[a-zA-Z0-9_]{12,})\b/g, "[REDACTED]")
    .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, "[REDACTED]");
  return text;
}

/** Complete lines only: secrets and UTF-8 can span arbitrary stdout chunks. */
export function activityLineSink(emit: (line: string) => void, secrets: string[] = []) {
  const decoder = new StringDecoder("utf8");
  let buffer = "", dropping = false, privateKey = false, lines = 0, bytes = 0, limited = false;
  function output(line: string) {
    if (line.includes("-----BEGIN ") && /PRIVATE KEY/.test(line)) { privateKey = true; line = "[Private key output omitted]"; }
    else if (privateKey) { if (/-----END .*PRIVATE KEY-----/.test(line)) privateKey = false; return; }
    if (!line.trim()) return;
    const safe = redactActivityText(line, secrets).slice(0, 4096);
    if (++lines > 500 || (bytes += Buffer.byteLength(safe)) > 256 * 1024) {
      if (!limited) emit("[Additional tool output omitted; operation continues]");
      limited = true; return;
    }
    emit(safe);
  }
  function consume(text: string) {
    for (const part of text.split(/(\r\n|\r|\n)/)) {
      if (/^(?:\r\n|\r|\n)$/.test(part)) {
        if (dropping) { output("[Long output line omitted]"); dropping = false; }
        else output(buffer);
        buffer = "";
      } else if (!dropping) {
        buffer += part;
        if (buffer.length > 16 * 1024) { buffer = ""; dropping = true; }
      }
    }
  }
  return {
    write(chunk: Buffer) { consume(decoder.write(chunk)); },
    end() { consume(decoder.end()); if (dropping) output("[Long output line omitted]"); else if (buffer) output(buffer); buffer = ""; },
  };
}
