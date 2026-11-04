# Dependency collection and installation — development source

DevTeleport can detect several project types in the same workspace, collect a static preview of their declared libraries, and run the appropriate dependency manager after review and explicit approval. The package manager downloads the direct and transitive dependencies from the project's manifests, lockfiles and configured registries. DevTeleport does not guess library versions or download each library itself.

This feature is included in the local **0.2.2 release candidate**, with its final DMG at `dist/releases/v0.2.2/DevTeleport V0.2.2.dmg`. The fresh complete native gate passed 21 stages; see [0.2.2 validation](RELEASE-0.2.2.md). Existing public downloads do not gain changes automatically, and local packaging is not publication. The earlier source/preview checks below retain their historical scope.

## Desktop workflow

1. Choose a snapshot and a new restore destination, then select **Review restore**.
2. Under **What this project needs**, review the detected projects, library groups, install commands, tools and blockers.
3. If every project is ready, approve **Restore and install dependencies** and complete the restore. This installs the detected projects using their selected managers.
4. If a project needs a missing SDK or manual setup, leave dependency installation off and restore the files first. The restored project is then available under **Dependency recovery**.
5. Select the installation locations that are ready, click **Review selected packages**, approve the displayed commands, and run setup in the existing restored folder. A missing tool for an unselected project does not block the selected supported projects.
6. If an installation fails, use the same recovery panel to retry it. Earlier successful installations remain visible, and failed or unfinished locations are selected by default.

A single folder can contain different project types, such as a Node frontend and a Python API. They have distinct installation identities and statuses even when their manifests share a folder. Declared workspace members share their manager's root action where ownership can be established. The desktop currently remembers the last restored project's dependency setup, rather than a library of every previous setup attempt.

After installation, use the project's README and startup commands. Dependency setup does not start servers, restore additional databases, provision credentials or certify that the application is ready.

## Current adapter coverage

| Project metadata                                   | Dependency setup                                                         | Important boundary                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node `package.json`, npm lock/shrinkwrap           | `npm ci` with a lock; `npm install` without one                          | Requests runtime, development, optional and peer types. The manager may skip incompatible optional packages.                                             |
| Node `package.json`, `pnpm-lock.yaml`              | Frozen pnpm installation with a lock; resolving installation without one | Requests production/development packages and optional dependencies. Existing script/build policies remain in force.                                      |
| Node `package.json`, `yarn.lock`                   | Yarn Classic frozen installation or modern Yarn immutable installation   | Uses the already installed Yarn generation; no Corepack/Yarn runtime provisioning is requested.                                                          |
| Node `package.json`, Bun lock                      | Bun installation, frozen when a lock exists                              | Requires an installed native Bun executable.                                                                                                             |
| Python `requirements.txt` / `requirements-dev.txt` | pip installation into a private project virtual environment              | Reviewed local requirements/constraint includes are followed. Unsafe destination options or outside paths block automatic setup.                         |
| Standard Python `pyproject.toml`                   | pip project installation into the private environment                    | Installs standard project/build dependencies. Optional extras and custom development groups need the project's documented command.                       |
| Python `pyproject.toml` with uv metadata/lock      | `uv sync`, locked when `uv.lock` exists, including groups                | Standalone projects only; uv workspace membership requires manual review.                                                                                |
| Python `pyproject.toml` with Poetry metadata/lock  | `poetry install --no-interaction`                                        | Uses the private environment; automatic Poetry plugin provisioning is blocked.                                                                           |
| Java Maven `pom.xml`                               | `mvn --batch-mode --file ./pom.xml dependency:go-offline`                | Downloads dependencies/plugins for the reactor. Profiles with conditional modules and outside/missing modules require manual review.                     |
| Java Gradle build/settings files                   | Installed Gradle plus an app-authored dependency-resolution init script  | Resolves resolvable configurations; project configuration/plugins run after approval. Captured wrappers are not executed. JDK auto-download is disabled. |
| Go `go.mod`                                        | `go mod download`                                                        | Populates the module cache. `go.work` configurations require manual review; Go toolchain auto-download is disabled.                                      |
| Rust `Cargo.toml`                                  | `cargo fetch`, with `--locked` when the root lock exists                 | Literal workspace ownership is recognized; outside/dynamic workspace destinations need review.                                                           |
| Ruby `Gemfile`                                     | `bundle install`                                                         | Uses a managed project-local gem directory, includes groups, and freezes an existing lock. Gemfile is executable Ruby.                                   |
| PHP `composer.json`                                | `composer install --no-interaction --prefer-dist`                        | Includes development dependencies and uses a vendor directory inside the package. Composer scripts/plugins may execute.                                  |
| .NET solution or C#/F#/VB project                  | `dotnet restore`, with locked mode when applicable                       | Literal solution references share a restore action. Requires a configured .NET SDK and package feeds.                                                    |
| Dart/Flutter `pubspec.yaml`                        | `dart pub get` or `flutter pub get`, enforcing an existing lock          | Mobile/desktop SDKs and native plugin requirements may still need manual setup.                                                                          |
| Swift `Package.swift`, Elixir `mix.exs`            | Detected with manual-setup guidance                                      | Automatic installation is not implemented by these adapters.                                                                                             |

Pipenv and legacy setup.py/setup.cfg-only Python projects also receive manual-setup guidance. Complex workspace syntax, conflicting lockfiles, unsupported metadata and missing tools remain visible blockers. A build system's default features, profiles, extras and platform rules still determine which packages are installed; this feature does not select every possible optional feature of every project.

## Library inventory and lockfiles

The library list is a **static preview**, not an exhaustive resolved dependency graph. Node declarations are grouped into runtime, development, optional and peer categories. Other formats expose literal names that can be identified without evaluating the build configuration. Dynamic Gradle declarations, aliases, inherited Maven properties, generated metadata and similar constructs can prevent a complete name list. The manager evaluates the full project configuration only after approval.

The preview avoids exposing raw dependency URLs or requirement values that might contain feed credentials. Some project names, paths and dependency names can still be private; review exported logs before sharing them.

Existing locks select frozen, immutable or locked behavior where supported. A missing lock can cause resolution and creation of new metadata. Maven and Gradle do not provide one universal lock mode covering every plugin and project configuration; the preview does not claim identical resolution across arbitrary builds. Optional/platform-specific packages can be skipped by their manager, and private registries require trusted credentials.

Manager behavior references: [npm install](https://docs.npmjs.com/cli/commands/npm-install/), [pnpm install](https://pnpm.io/cli/install), [Yarn Classic install](https://classic.yarnpkg.com/en/docs/cli/install), [modern Yarn install](https://yarnpkg.com/cli/install), [pip install](https://pip.pypa.io/en/stable/cli/pip_install/), [uv sync and locking](https://docs.astral.sh/uv/concepts/projects/sync/), [Poetry commands](https://python-poetry.org/docs/cli/).

## Python environments

Python installation uses `.devteleport/python-env` inside the corresponding project folder. DevTeleport checks ownership and interpreter paths before using or reusing this environment; it refuses a captured or independently created environment it cannot validate. It does not install packages into system Python. pip configuration files are disabled for this isolated installation; configure private-feed access through a trusted environment or use a trusted terminal when necessary.

After successful setup, open a terminal in that Python project folder and activate the environment:

```sh
source .devteleport/python-env/bin/activate
```

Then use the project's normal startup command. Each independent Python subproject has its own environment. Python, pip/venv support, uv or Poetry must already be available as required. Runtime downloads and automatic Poetry plugin provisioning are not part of this flow. See [Python's venv documentation](https://docs.python.org/3/library/venv.html) and [uv managed-Python controls](https://docs.astral.sh/uv/reference/cli/).

## Review and execution boundaries

Reviewing reads metadata and probes installed native tools; it does not install project dependencies. Execution requires explicit approval. The reviewed plan binds the metadata inventory, toolchain and canonical project path. Desktop approval additionally binds the target identity, selected installation keys and tool directories. Changing these requires a new review, and approval is consumed by one execution attempt.

Installation may execute project build files, plugins, package builds and lifecycle hooks with the user's permissions. This is **not an execution sandbox**. Existing package-manager script/security policies are preserved. The adapters do not install system runtimes, global npm tools, database servers, service credentials or arbitrary operating-system libraries. A required SDK, native compiler, private feed or platform service can still prevent setup from succeeding.

Failure/cancellation preserves restored source and earlier completed installations. It does not roll back package-manager changes across projects. Per-project statuses distinguish selected successes, failures, unfinished work and historical successes. Read [Dependency recovery](DEPENDENCY-RETRY.md) for the retry flow.

Other manager references: [Maven go-offline](https://maven.apache.org/components/plugins/maven-dependency-plugin/go-offline-mojo.html), [Gradle initialization scripts](https://docs.gradle.org/current/userguide/init_scripts.html), [Gradle JDK provisioning controls](https://docs.gradle.org/current/userguide/toolchains.html), [Go modules](https://go.dev/ref/mod), [Cargo fetch](https://doc.rust-lang.org/cargo/commands/cargo-fetch.html), [Bundler deployment/local installation](https://bundler.io/guides/deploying.html), [Composer install](https://getcomposer.org/doc/03-cli.md), [.NET restore](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-restore), [Dart/Flutter pub get](https://dart.dev/tools/pub/cmd/pub-get).

## CLI selection

In the checkout, use `node apps/cli/main.ts` in place of `devteleport` until the corresponding CLI is released:

```sh
devteleport setup /path/to/restored-project
```

Read the current plan and its `id`. A selected execution uses the exact installation keys shown in that plan:

```sh
devteleport setup /path/to/restored-project --install --approve-execution \
  --plan-id REVIEWED_PLAN_ID --install-at python3:.
```

Existing Node keys remain directory names, such as `.` or `api`. New adapters use manager-qualified keys such as `python3:.`, `uv:api`, `cargo:services/worker` or `composer:php`. .NET keys also identify the project/solution filename, such as `dotnet:src/App.csproj`, so multiple .NET projects in one folder remain distinct. Repeat `--install-at` for multiple reviewed keys. Copy the exact key rather than constructing one from a displayed label.

## Validation limits

Earlier feature-preview checkpoint on 4 November 2026: strict checks and **111 tests passed, zero failures/skips**. The existing source desktop smoke and retry checks passed. Source and packaged collection tests identified nine ecosystems across twelve disposable projects, checked four dark/light layouts each and reported zero renderer errors. That packaged test also installed/imported a local Python wheel through the approved UI without running unselected projects. Packaged retry, restart recovery, stale-review refusal, lifecycle-child cancellation and eight retry-panel layouts passed. Its separate ARM64 app is `dist/dependency-collection/desktop/mac-arm64/DevTeleport.app`; 48 architecture/integrity checks, 25 current-source matches and strict deep ad-hoc signature verification passed. Aggregate preview evidence is `dist/evidence/dependency-collection.json`. The subsequent 0.2.2 candidate includes a new final DMG and fresh complete 21-stage gate; see [the current validation report](RELEASE-0.2.2.md).

The new coverage has automated planning/dispatch and safety regressions. Actual local execution includes offline npm/pnpm fixtures, Python requirements and wheel installation into private virtual environments, source-removal restore checks, and an offline Ruby/Bundler path-gem installation. Standard pyproject installation has planning coverage. These checks prove the exercised fixtures; they do not establish compatibility with every registry package or framework.

Yarn, Bun, uv, Poetry, Maven, Gradle, Go, Cargo, Composer, .NET, Dart and Flutter SDKs were not all available for actual native downloads on the reference host. Their adapter behavior is covered by planning/guard tests where recorded, while live SDK/network acceptance remains separate work. Consult the current [status](STATUS.md) and saved evidence for final test counts, packaged acceptance and exact artifact boundaries. The local 0.2.2 gate does not establish hosted CI, a signed/notarized installer or public publication; those remain separate actions.
