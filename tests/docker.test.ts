import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { composePlan } from "../packages/core/index.ts";
if (process.env.DEVTELEPORT_TEST_DOCKER === "1")
  test("real Docker Compose configuration projects services without secrets", async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-docker-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(
      path.join(root, "compose.yaml"),
      'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "127.0.0.1:8080:80"\n    environment:\n      PASSWORD: do-not-report-this\n    volumes:\n      - data:/data\nvolumes:\n  data:\n',
    );
    const plan = await composePlan(root);
    assert.equal(plan.services[0].name, "web");
    assert.equal(plan.services[0].image, "nginx:alpine");
    assert.equal(plan.volumesCaptured, false);
    assert(!JSON.stringify(plan).includes("do-not-report-this"));
  });
