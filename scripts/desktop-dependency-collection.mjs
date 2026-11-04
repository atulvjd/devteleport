import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

// Review-only ecosystem inventory and execution-free restore in a disposable profile.
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-collection-ui-"));
const root = path.join(temp, "source");
const target = path.join(temp, "restored");
const output = path.resolve("dist/dependency-collection");
const passphrase = "dependency collection disposable fixture passphrase";
const checks = [],
  rendererErrors = [];
let app;
async function write(relative, text) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}
function record(name, detail = {}) {
  checks.push({ name, status: "PASS", ...detail });
  console.log("PASS " + name);
}
try {
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir("dist/evidence", { recursive: true });
  await write(
    "README.md",
    "# Dependency collection\nOnly declared metadata is reviewed.\n",
  );
  await write(
    "package.json",
    JSON.stringify({
      name: "collection-web",
      private: true,
      dependencies: { react: "^19.0.0" },
      devDependencies: { vite: "^7.0.0" },
      optionalDependencies: { "collection-optional": "^1.0.0" },
      peerDependencies: { "collection-peer": "^2.0.0" },
      scripts: { dev: "node server.cjs" },
    }),
  );
  await write("server.cjs", "console.log('start manually');\n");
  await write("requirements.txt", "rich==14.0.0\n");
  await write(
    "api/package.json",
    JSON.stringify({
      name: "collection-api <img data-collection-injection>",
      private: true,
      dependencies: {
        express: "^5.0.0",
        "private-fixture":
          "https://fixture:inventory-private-secret@example.invalid/library.tgz",
      },
    }),
  );
  await write("python/requirements.txt", "requests==2.32.5\n");
  await write(
    "go/go.mod",
    "module example.invalid/collection\n\ngo 1.23\n\nrequire example.invalid/library v1.0.0\n",
  );
  await write(
    "rust/Cargo.toml",
    '[package]\nname = "collection-rust"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nserde = "1"\n',
  );
  await write(
    "php/composer.json",
    JSON.stringify({ name: "collection/php", require: { "psr/log": "^3.0" } }),
  );
  await write(
    "ruby/Gemfile",
    'source "https://rubygems.org"\ngem "rack", "~> 3.0"\n',
  );
  await write(
    "java/pom.xml",
    "<project><modelVersion>4.0.0</modelVersion><groupId>invalid.example</groupId><artifactId>collection</artifactId><version>1.0</version><dependencies><dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>2.0.0</version></dependency></dependencies></project>\n",
  );
  await write(
    "dotnet/Collection.csproj",
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="Example.Collection" Version="1.0.0" /></ItemGroup></Project>\n',
  );
  await write(
    "dart/pubspec.yaml",
    'name: collection_dart\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\ndependencies:\n  http: ^1.0.0\n',
  );
  // Deterministic blocker: the app cannot execute this unsupported package manager.
  await write(
    "manual/package.json",
    JSON.stringify({
      name: "manual-only",
      packageManager: "unsupported-manager@1.0.0",
      dependencies: { "manual-library": "1.0.0" },
    }),
  );
  const env = {
    ...process.env,
    DEVTELEPORT_USER_DATA: path.join(temp, "profile"),
    PIP_NO_INDEX: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    ...(process.env.DEVTELEPORT_APP_BINARY
      ? { executablePath: process.env.DEVTELEPORT_APP_BINARY, args: [] }
      : { args: ["apps/desktop/main.cjs"] }),
    env,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForSelector("#source");
  await page.waitForFunction(
    () =>
      document.getElementById("architecture").textContent !==
      "Checking runtime…",
  );
  if (await page.locator("#welcome").isVisible())
    await page.locator("#welcomeDone").click();
  async function finish(expected = "Completed") {
    await page.waitForFunction(
      () =>
        document.getElementById("cancel").hidden &&
        ["Completed", "Needs attention"].includes(
          document.getElementById("status").textContent,
        ),
    );
    assert.equal(
      await page.locator("#status").textContent(),
      expected,
      await page.locator("#result").textContent(),
    );
  }
  await page.locator("#source").fill(root);
  await page.locator('[data-action="inspect"]').click();
  await finish();
  await page.locator('button[data-view="capture"]').click();
  await page.locator("#name").fill("collection-fixture");
  await page.locator("#output").fill(temp);
  await page.locator("#capturePassword").fill(passphrase);
  await page.locator('[data-action="capture"][data-dry="true"]').click();
  await finish();
  await page.locator('[data-action="capture"].primary').click();
  await finish();
  await fs.rm(root, { recursive: true });
  await page.locator('button[data-view="restore"]').click();
  await page
    .locator("#snapshot")
    .fill(path.join(temp, "collection-fixture.dtp"));
  await page.locator("#target").fill(target);
  await page.locator("#restorePassword").fill(passphrase);
  await page.locator("#install").check();
  await page.locator('[data-action="restore"][data-dry="true"]').click();
  await finish("Needs attention");
  await assert.rejects(fs.stat(target), { code: "ENOENT" });
  assert(await page.locator('[data-action="restore"].primary').isDisabled());
  assert(await page.locator("#dependencyCollection").isVisible());
  const packages = page.locator(".setup-package[data-ecosystem]");
  const ecosystems = await packages.evaluateAll((items) => [
    ...new Set(items.map((item) => item.dataset.ecosystem)),
  ]);
  assert(ecosystems.includes("Node.js"));
  assert(ecosystems.includes("Python"));
  assert(
    ecosystems.length >= 4,
    "Mixed-language projects must be inventoried rather than silently treated as Node-only",
  );
  const nodePackage = page
    .locator('.setup-package[data-ecosystem="Node.js"]')
    .filter({ hasText: "collection-web" });
  for (const [category, name] of [
    ["runtime", "react"],
    ["development", "vite"],
    ["optional", "collection-optional"],
    ["peer", "collection-peer"],
  ]) {
    assert(
      (
        await nodePackage
          .locator(`[data-dependency-group="${category}"]`)
          .textContent()
      ).includes(name),
    );
  }
  const guide = await page.locator("#restoreSetup").textContent();
  assert(guide.includes("requests"));
  assert(!guide.includes("No supported Node.js packages were found"));
  assert(!guide.includes("inventory-private-secret"));
  assert(
    !(await page.locator("#result").textContent()).includes(
      "inventory-private-secret",
    ),
  );
  assert.equal(await page.locator("[data-collection-injection]").count(), 0);
  for (const details of await page.locator("#setupPackages details").all())
    await details.locator("summary").click();
  record(
    "mixed ecosystem inventory and all Node declaration categories are visible",
    { ecosystems },
  );
  record(
    "dependency blockers prevent execution while review creates no destination",
  );
  for (const theme of ["dark", "light"]) {
    await page.locator('button[data-view="settings"]').click();
    await page.locator("#theme").selectOption(theme);
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.theme === theme,
      theme,
    );
    for (const width of [1140, 800]) {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setBounds({ width, height: 820 }),
        width,
      );
      await page.locator('button[data-view="restore"]').click();
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(
        layout.scroll <= layout.width + 1,
        `${theme}/${width}: horizontal overflow`,
      );
      await page.locator("#restoreSetup").screenshot({
        path: path.join(output, `collection-${theme}-${width}.png`),
        animations: "disabled",
      });
      record("inventory layout", { theme, width: layout.width });
    }
  }
  await page.locator("#install").uncheck();
  await page.locator('[data-action="restore"][data-dry="true"]').click();
  await finish();
  await page.locator('[data-action="restore"].primary').click();
  await finish();
  assert.match(
    await fs.readFile(path.join(target, "python/requirements.txt"), "utf8"),
    /requests/,
  );
  await assert.rejects(fs.stat(path.join(target, "node_modules")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.stat(path.join(target, "python/.venv")), {
    code: "ENOENT",
  });
  record(
    "files-only restore preserves mixed-language source without running installers",
  );
  assert(await page.locator("#setupRecovery").isVisible());
  const rootNode = page.locator(
    '[data-setup-select][data-setup-directory="."]',
  );
  const rootPython = page.locator(
    '[data-setup-select][data-setup-directory="python3:."]',
  );
  assert.equal(await rootNode.count(), 1);
  assert.equal(await rootPython.count(), 1);
  for (const checkbox of await page.locator("[data-setup-select]").all())
    await checkbox.uncheck();
  await rootNode.check();
  await page.locator("#reviewSetup").click();
  await finish();
  assert(await page.locator("#runSetup").isDisabled());
  assert(!(await page.locator("#approveSetup").isChecked()));
  await assert.rejects(fs.stat(path.join(target, "node_modules")), {
    code: "ENOENT",
  });
  record(
    "files-only recovery keeps colocated Node/Python installations distinct and reviews selected Node without unrelated blockers",
  );
  if (spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0) {
    const wheel = "desktop_python_fixture-1.0.0-py3-none-any.whl";
    execFileSync(
      "python3",
      [
        "-c",
        [
          "import zipfile,sys",
          "z=zipfile.ZipFile(sys.argv[1],'w')",
          "z.writestr('desktop_python_fixture/__init__.py',\"VALUE = 'desktop installed'\\n\")",
          "z.writestr('desktop_python_fixture-1.0.0.dist-info/METADATA','Metadata-Version: 2.1\\nName: desktop-python-fixture\\nVersion: 1.0.0\\n')",
          "z.writestr('desktop_python_fixture-1.0.0.dist-info/WHEEL','Wheel-Version: 1.0\\nGenerator: devteleport-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')",
          "z.writestr('desktop_python_fixture-1.0.0.dist-info/RECORD','')",
          "z.close()",
        ].join(";"),
        path.join(target, wheel),
      ],
      { timeout: 15000 },
    );
    // This is an intentional local requirements change, followed by a new
    // review and approval. No public registry or user's project is touched.
    await fs.writeFile(path.join(target, "requirements.txt"), wheel + "\n");
    await rootNode.uncheck();
    await rootPython.check();
    await page.locator("#reviewSetup").click();
    await finish();
    await page.locator("#approveSetup").check();
    await page.locator("#runSetup").click();
    await finish();
    const installed = execFileSync(
      path.join(target, ".devteleport/python-env/bin/python"),
      [
        "-I",
        "-c",
        "import desktop_python_fixture; print(desktop_python_fixture.VALUE)",
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(installed.trim(), "desktop installed");
    assert.match(
      await page
        .locator('[data-setup-status][data-setup-directory="python3:."]')
        .textContent(),
      /installed/i,
    );
    await assert.rejects(fs.stat(path.join(target, "node_modules")), {
      code: "ENOENT",
    });
    record(
      "approved Python-only desktop setup installs a local wheel into its private environment without running unselected projects",
    );
  } else {
    checks.push({
      name: "actual Python desktop installation",
      status: "SKIPPED",
      reason: "python3 is unavailable",
    });
  }
  assert.deepEqual(rendererErrors, []);
  await fs.writeFile(
    "dist/evidence/desktop-dependency-collection.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        packaged: Boolean(process.env.DEVTELEPORT_APP_BINARY),
        fixture:
          "Disposable multi-language metadata; source removed before files-only restore; approved Python-only local-wheel installation; no public registry downloads.",
        checks,
        rendererErrors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: Desktop dependency collection, grouped inventory, blockers, files-only recovery and layouts.",
  );
} finally {
  await app?.close();
  await fs.rm(temp, { recursive: true, force: true });
}
