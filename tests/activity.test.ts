import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  activityLineSink,
  activitySecrets,
  redactActivityText,
} from "../packages/core/activity.ts";
import { execText } from "../packages/core/processes.ts";
import { setupDirectory } from "../packages/core/setup.ts";
import { capture, restore } from "../packages/core/index.ts";

test("console filtering strips terminal control codes, known secrets, credentials and credential URLs", () => {
  const input =
    '\x1b[31mBuild started\x1b[0m\nTOKEN=private-token-value\nAuthorization: Bearer private-bearer-value\nhttps://bob:private-password@registry.example/pkg?access=private-query\n{"api_key":"private-api-value"}\nmy fixture passphrase\n';
  const output = redactActivityText(
    input,
    activitySecrets({ APP_SECRET: "my fixture passphrase" }),
  );
  for (const value of [
    "private-token-value",
    "private-bearer-value",
    "private-password",
    "private-query",
    "private-api-value",
    "my fixture passphrase",
    "\x1b",
  ])
    assert(!output.includes(value), value);
  assert(output.includes("Build started"));
  assert(output.includes("[REDACTED]"));
  const long = "plain".repeat(4000);
  assert.equal(redactActivityText(long), long);
});

test("chunked output waits for complete lines, preserves split Unicode and suppresses private keys", () => {
  const lines: string[] = [],
    sink = activityLineSink(
      (line) => lines.push(line),
      ["a passphrase with spaces"],
    );
  sink.write(Buffer.from("TOKEN=split-"));
  assert.equal(lines.length, 0);
  sink.write(Buffer.from("secret\na passphrase with "));
  sink.write(Buffer.from("spaces\n"));
  const unicode = Buffer.from("résumé ✓\n");
  for (const byte of unicode) sink.write(Buffer.from([byte]));
  sink.write(
    Buffer.from(
      "-----BEGIN PRIVATE KEY-----\nprivate-key-payload\n-----END PRIVATE KEY-----\nDone",
    ),
  );
  sink.end();
  assert(!lines.join("\n").includes("split-secret"));
  assert(!lines.join("\n").includes("a passphrase with spaces"));
  assert(!lines.join("\n").includes("private-key-payload"));
  assert(lines.includes("résumé ✓"));
  assert.equal(lines.at(-1), "Done");
});

test("console line and event limits drop unsafe partial lines and bound high-volume output", () => {
  const lines: string[] = [],
    sink = activityLineSink((line) => lines.push(line));
  sink.write(Buffer.from("TOKEN=" + "x".repeat(20000)));
  sink.write(Buffer.from("\n"));
  for (let i = 0; i < 10000; i++) sink.write(Buffer.from(`event ${i}\n`));
  sink.end();
  assert.equal(lines[0], "[Long output line omitted]");
  assert(lines.length <= 501);
  assert(lines.at(-1)?.includes("Additional tool output omitted"));
  assert(!lines.some((line) => line.includes("TOKEN=")));
});

test("supervised tool output is delivered while the process is still running", async () => {
  let first;
  const seen = new Promise<void>((resolve) => (first = resolve));
  let complete = false,
    stdout = "";
  const operation = execText(
    process.execPath,
    [
      "-e",
      "console.log('first live line');setTimeout(()=>console.log('last line'),500)",
    ],
    {
      onOutput(stream, bytes) {
        if (stream === "stdout") {
          stdout += bytes.toString();
          first();
        }
      },
      timeout: 5000,
    },
  ).then(() => {
    complete = true;
  });
  await seen;
  assert.equal(complete, false);
  assert(stdout.includes("first live line"));
  await operation;
  assert(stdout.includes("last line"));
});

test("approved dependency install emits filtered stdout/stderr without persisting raw output", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-console-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "console-fixture",
      private: true,
      scripts: { postinstall: "node build.cjs", dev: "node app.cjs" },
    }),
  );
  await fs.writeFile(
    path.join(root, "build.cjs"),
    "console.log('Compiling project');console.log('TOKEN=fixture-token-value');console.error('Build warning');require('node:fs').writeFileSync('ready','yes');",
  );
  const events: { stream: string; text: string }[] = [];
  const result = await setupDirectory(root, true, true, undefined, (event) =>
    events.push(event),
  );
  assert.equal(result.installation?.completed.length, 1);
  assert(events.some((e) => e.text.includes("Compiling project")));
  assert(
    events.some(
      (e) => e.stream === "stderr" && e.text.includes("Build warning"),
    ),
  );
  assert(!JSON.stringify(events).includes("fixture-token-value"));
  assert.equal(await fs.readFile(path.join(root, "ready"), "utf8"), "yes");
});

test("direct archive restore callbacks filter the supplied passphrase even without a password environment variable", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-console-restore-")),
    root = path.join(temp, "project");
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.mkdir(root);
  const password = "console direct callback passphrase";
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "direct-callback",
      scripts: { postinstall: "node install.cjs" },
    }),
  );
  await fs.writeFile(
    path.join(root, "install.cjs"),
    `console.log(${JSON.stringify(password)});console.log('<img data-console-injection>');`,
  );
  const archive = await capture({
    root,
    output: temp,
    name: "direct",
    password,
    format: 2,
  });
  const events: string[] = [];
  await restore(archive.output, {
    password,
    target: path.join(temp, "restored"),
    install: true,
    approveExecution: true,
    onLog: (event) => events.push(event.text),
  });
  assert(!events.join("\n").includes(password));
  assert(events.join("\n").includes("[REDACTED]"));
});
