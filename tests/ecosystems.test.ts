import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  ecosystemMetadataNames,
  isEcosystemMetadata,
  planEcosystems,
  executeEcosystem,
} from "../packages/core/ecosystems.ts";
import type { SnapshotEntry } from "../packages/core/types.ts";

async function plan(contents: Record<string, string>) {
  const entries: SnapshotEntry[] = Object.entries(contents).map(
    ([file, text]) => ({
      path: file,
      type: "file",
      mode: 0o600,
      data: "",
      size: Buffer.byteLength(text),
      checksum: crypto.createHash("sha256").update(text).digest("hex"),
    }),
  );
  return planEcosystems(entries, async (file) => contents[file] ?? null);
}

test("language metadata includes build inputs and configuration without treating every source file as metadata", () => {
  assert(ecosystemMetadataNames.has("Cargo.toml"));
  for (const file of [
    "src/App.csproj",
    "Orbit.slnx",
    ".mvn/maven.config",
    ".cargo/config.toml",
    ".bundle/config",
    "gradle/dependency-locks/compile.lockfile",
  ])
    assert(isEcosystemMetadata(file), file);
  for (const file of ["README.md", "src/App.java", "random.env", "app.dart"])
    assert(!isEcosystemMetadata(file), file);
});

test("Go, Ruby and Composer plans retain names while withholding private feed values", async () => {
  const plans = await plan({
    "api/go.mod":
      "module orbit.test/api\n\ngo 1.24\nrequire example.com/library v1.0.0\n",
    "api/go.sum": "example.com/library v1.0.0 h1:dummy\n",
    Gemfile:
      "source 'https://private-token@example.com'\ngem 'rack'\ngroup :development do\n gem 'rake'\nend\n",
    "Gemfile.lock": "GEM\n",
    "php/composer.json": JSON.stringify({
      require: { "vendor/runtime": "^1" },
      "require-dev": { "vendor/dev": "^2" },
      repositories: [{ url: "https://composer-private-value@example.test" }],
    }),
    "php/composer.lock": "{}",
  });
  assert.deepEqual(plans.find((p) => p.manager === "go")!.command, [
    "go",
    "mod",
    "download",
  ]);
  assert.deepEqual(plans.find((p) => p.manager === "bundle")!.dependencies, [
    "rack",
    "rake",
  ]);
  const php = plans.find((p) => p.manager === "composer")!;
  assert.deepEqual(php.dependencies, ["vendor/dev", "vendor/runtime"]);
  assert.equal(php.installKey, "composer:php");
  assert(!JSON.stringify(plans).includes("private-token"));
  assert(!JSON.stringify(plans).includes("composer-private-value"));
});

test("Go workspace destinations are identified as requiring manual review", async () => {
  const plans = await plan({
    "go.work": "go 1.24\nuse ../outside\n",
    "api/go.mod": "module orbit.test/api\ngo 1.24\n",
  });
  assert(plans[0].blockers.some((blocker) => blocker.includes("workspace")));
});

test("Cargo workspace members share their root fetch and lock while excluded crates stay independent", async () => {
  const plans = await plan({
    "Cargo.toml":
      '[workspace]\nmembers = ["crates/*"]\nexclude = ["crates/standalone"]\n[workspace.dependencies]\nserde = "1"\n',
    "Cargo.lock": "version = 4\n",
    "crates/api/Cargo.toml":
      '[package]\nname="api"\n[dependencies]\nserde = { workspace = true }\n[dev-dependencies]\nassert_matches="1"\n',
    "crates/standalone/Cargo.toml":
      '[package]\nname="standalone"\n[dependencies]\nregex="1"\n',
  });
  const root = plans.find((p) => p.directory === ".")!,
    member = plans.find((p) => p.directory === "crates/api")!,
    independent = plans.find((p) => p.directory === "crates/standalone")!;
  assert.deepEqual(root.command, ["cargo", "fetch", "--locked"]);
  assert.equal(member.installAt, ".");
  assert.equal(member.installKey, root.installKey);
  assert.deepEqual(member.dependencies, ["assert_matches", "serde"]);
  assert.equal(independent.installAt, "crates/standalone");
});

test("Cargo workspace members and exclusions refuse outside, URL and dynamic paths before fetch", async () => {
  for (const field of ["members", "exclude"]) {
    for (const destination of [
      "../external",
      "/outside",
      "https://example.test/crate",
      "C:/external",
      "~/.cargo",
      "$EXTERNAL",
      "..\\external",
    ]) {
      const plans = await plan({
        "Cargo.toml": `[workspace]\n${field} = [${JSON.stringify(destination)}]\n`,
      });
      assert(
        plans[0].blockers.some((blocker) =>
          /destinations|unsupported metadata/.test(blocker),
        ),
        `${field}: ${destination}`,
      );
    }
    const plans = await plan({
      "Cargo.toml": `[workspace]\n${field} = PROJECT_MEMBERS\n`,
    });
    assert(
      plans[0].blockers.some((blocker) => /unsupported metadata/.test(blocker)),
    );
  }
});

test("Maven reactors share one download action and reject outside modules and XML entity declarations", async () => {
  const plans = await plan({
    "pom.xml": "<project><modules><module>api</module></modules></project>",
    "api/pom.xml":
      "<project><dependencies><dependency><groupId>org.orbit</groupId><artifactId>library</artifactId></dependency></dependencies><modules><module>nested</module></modules></project>",
    "api/nested/pom.xml": "<project/>",
    "broken/pom.xml":
      '<!DOCTYPE project SYSTEM "https://private-value"><project><modules><module>../../external</module></modules></project>',
  });
  assert.equal(plans.find((p) => p.directory === "api")!.installAt, ".");
  assert.equal(plans.find((p) => p.directory === "api/nested")!.installAt, ".");
  assert.deepEqual(plans.find((p) => p.directory === "api")!.dependencies, [
    "org.orbit:library",
  ]);
  assert(plans.find((p) => p.directory === "broken")!.blockers.length >= 2);
  assert(!JSON.stringify(plans).includes("private-value"));
});

test("Gradle literal child projects share the root while dynamic includes require review", async () => {
  const plans = await plan({
    "settings.gradle": "include ':api', ':library'\n",
    "build.gradle": "dependencies { implementation 'org.orbit:runtime:1.0' }\n",
    "api/build.gradle.kts":
      'dependencies { implementation("org.orbit:child:1.0") }',
    "library/build.gradle": "",
    "dynamic/settings.gradle": "include(projectNames)\n",
  });
  assert.equal(plans.find((p) => p.directory === "api")!.installAt, ".");
  assert.equal(
    plans.find((p) => p.directory === "library")!.installKey,
    "gradle:.",
  );
  assert(
    plans
      .find((p) => p.directory === "dynamic")!
      .blockers.some((b) => /Dynamic/.test(b)),
  );
});

test(".NET solution ownership avoids duplicate project restores and independent same-folder projects have unique keys", async () => {
  const plans = await plan({
    "Orbit.sln":
      'Project("{TYPE}") = "Api", "src\\Api.csproj", "{ID}"\nEndProject\n',
    "src/Api.csproj":
      '<Project><ItemGroup><PackageReference Include="Orbit.Runtime" Version="1.0" /></ItemGroup></Project>',
    "src/packages.lock.json": "{}",
    "independent/First.csproj":
      '<Project><ItemGroup><PackageReference Include="First.Library" Version="1" /></ItemGroup></Project>',
    "independent/Second.fsproj":
      '<Project><ItemGroup><PackageReference Include="Second.Library" Version="1" /></ItemGroup></Project>',
  });
  assert.equal(plans.length, 3);
  const solution = plans.find((p) => p.name === "Orbit.sln")!;
  assert.deepEqual(solution.command, [
    "dotnet",
    "restore",
    "./Orbit.sln",
    "--locked-mode",
  ]);
  assert.deepEqual(solution.dependencies, ["Orbit.Runtime"]);
  assert.notEqual(plans[1].installKey, plans[2].installKey);
});

test("Dart and Flutter collect runtime and development packages and enforce existing locks", async () => {
  const plans = await plan({
    "pubspec.yaml":
      "name: orbit\ndependencies:\n  http: ^1.0.0\ndev_dependencies:\n  test: ^1.0.0\n",
    "pubspec.lock": "packages: {}\n",
    "mobile/pubspec.yaml":
      "name: orbit_mobile\ndependencies:\n  flutter:\n    sdk: flutter\n  provider: ^6.0.0\n",
  });
  assert.deepEqual(plans.find((p) => p.manager === "dart")!.command, [
    "dart",
    "pub",
    "get",
    "--enforce-lockfile",
  ]);
  assert.deepEqual(plans.find((p) => p.manager === "dart")!.dependencies, [
    "http",
    "test",
  ]);
  assert.equal(
    plans.find((p) => p.manager === "flutter")!.ecosystem,
    "Flutter",
  );
});

test("Gradle execution uses a private app-authored resolver and removes it after success and failure", async () => {
  const pkg = (await plan({ "build.gradle": "" }))[0];
  let transient = "";
  const handled = await executeEcosystem(
    pkg,
    "/unused",
    "/tools/gradle",
    async (file, args) => {
      assert.equal(file, "/tools/gradle");
      transient = args[args.indexOf("--init-script") + 1];
      assert(path.isAbsolute(transient));
      const script = await fs.readFile(transient, "utf8");
      assert(script.includes("it.canBeResolved"));
      assert(!script.includes("build.dependsOn"));
    },
    {},
  );
  assert(handled);
  await assert.rejects(fs.stat(transient), { code: "ENOENT" });
  await assert.rejects(
    executeEcosystem(
      pkg,
      "/unused",
      "/tools/gradle",
      async (_file, args) => {
        transient = args[args.indexOf("--init-script") + 1];
        throw new Error("fixture failure");
      },
      {},
    ),
    /fixture failure/,
  );
  await assert.rejects(fs.stat(transient), { code: "ENOENT" });
});

test("Bundler uses owned project-local gems, includes groups and freezes an existing lock", async (t) => {
  const os = await import("node:os");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-bundle-dispatch-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "Gemfile"), "gem 'rack'\n");
  await fs.writeFile(path.join(root, "Gemfile.lock"), "GEM\n");
  const pkg = (
    await plan({ Gemfile: "gem 'rack'\n", "Gemfile.lock": "GEM\n" })
  )[0];
  let called = 0;
  await executeEcosystem(
    pkg,
    root,
    "/tools/bundle",
    async (file, args, env) => {
      called++;
      assert.equal(file, "/tools/bundle");
      assert.deepEqual(args, ["install"]);
      assert.equal(
        env!.BUNDLE_PATH,
        path.join(await fs.realpath(root), ".devteleport/bundle"),
      );
      assert.equal(env!.BUNDLE_WITHOUT, "");
      assert.equal(env!.BUNDLE_FROZEN, "true");
      assert.equal(env!.BUNDLE_GEMFILE, path.join(root, "Gemfile"));
    },
    {
      BUNDLE_PATH: "/outside",
      BUNDLE_WITHOUT: "development",
      BUNDLE_FROZEN: "false",
    },
  );
  assert.equal(called, 1);
  // The existing ownership marker permits a retry, but symlinks never do.
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "dtp-bundle-outside-"),
  );
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(root, ".devteleport/bundle/link"));
  await assert.rejects(
    executeEcosystem(
      pkg,
      root,
      "/tools/bundle",
      async () => {
        called++;
      },
      {},
    ),
    /symbolic link/,
  );
  assert.equal(called, 1);
});

test("Bundler refuses an unowned captured installation directory before invoking the tool", async (t) => {
  const os = await import("node:os");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dtp-unowned-bundle-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".devteleport/bundle"), { recursive: true });
  const pkg = (await plan({ Gemfile: "gem 'rack'\n" }))[0];
  let called = false;
  await assert.rejects(
    executeEcosystem(
      pkg,
      root,
      "/tools/bundle",
      async () => {
        called = true;
      },
      {},
    ),
    { code: "EEXIST" },
  );
  assert(!called);
});

test("Composer includes development packages and refuses outside or symbolic-link vendor destinations", async (t) => {
  const os = await import("node:os");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "dtp-composer-dispatch-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pkg = (
    await plan({ "composer.json": '{"require":{"vendor/library":"^1"}}' })
  )[0];
  await fs.writeFile(
    path.join(root, "composer.json"),
    '{"config":{"vendor-dir":"deps/vendor"}}',
  );
  let called = 0;
  await executeEcosystem(
    pkg,
    root,
    "/tools/composer",
    async (_file, args, env) => {
      called++;
      assert.deepEqual(args, ["install", "--no-interaction", "--prefer-dist"]);
      assert.equal(env!.COMPOSER_NO_DEV, "0");
      assert.equal(env!.COMPOSER, path.join(root, "composer.json"));
      assert.equal(env!.COMPOSER_VENDOR_DIR, path.join(root, "deps/vendor"));
    },
    {
      COMPOSER_NO_DEV: "1",
      COMPOSER: "/outside/composer.json",
      COMPOSER_VENDOR_DIR: "/outside",
    },
  );
  await fs.writeFile(
    path.join(root, "composer.json"),
    '{"config":{"vendor-dir":"../outside"}}',
  );
  await assert.rejects(
    executeEcosystem(
      pkg,
      root,
      "/tools/composer",
      async () => {
        called++;
      },
      {},
    ),
    /inside/,
  );
  await fs.writeFile(path.join(root, "composer.json"), "{}");
  await fs.symlink(os.tmpdir(), path.join(root, "vendor"));
  await assert.rejects(
    executeEcosystem(
      pkg,
      root,
      "/tools/composer",
      async () => {
        called++;
      },
      {},
    ),
    /symbolic-link/,
  );
  assert.equal(called, 1);
});
