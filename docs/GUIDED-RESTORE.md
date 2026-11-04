# Guided dependency restore — development preview

The current local candidate is **0.2.1**, with all guided setup, settings-only/empty pnpm support, ignored-file capture and live-console fixes. Earlier preview paths/counts below are historical. Consult [0.2.1 validation](RELEASE-0.2.1.md) for the current final artifact; public 0.2.0 downloads remain unchanged until separately published.

## Settings-only pnpm configuration follow-up (2 November 2026)

A restore review reported zero package installs and a generic metadata blocker for a valid `pnpm-workspace.yaml` containing only `minimumReleaseAgeExclude`. Dependency planning now accepts a literal settings-only file without `packages`, and explicit `packages: []`, as root-only pnpm workspace configuration. It keeps unrelated nested npm projects as independent installs and does not use package.json workspace declarations to override a present pnpm workspace file. Unsupported/complex YAML still requires manual review; managed runtime provisioning remains blocked. Reference: [pnpm settings / packages](https://pnpm.io/settings#packages).

Failed metadata review shows controlled reasons including the affected metadata path, without raw JSON parser snippets or file bodies. The desktop shows Needs attention, logs the blockers, disables Restore & install and does not claim zero packages were discovered or promise installation. Files-only recovery remains available after turning installation off and reviewing again.

Read-only planning of the user's current source project now detects two independent installation locations: root `pnpm install --frozen-lockfile`, nested `npm ci --no-audit --no-fund`, with no local tool/runtime blockers. This did not decrypt the user's existing archive, install dependencies, modify the project or create a restore destination. Source-manifest evidence is `dist/dependency-review/project-plan.json`; existing archives can be reviewed by the fixed app without recapture.

Latest local preview: `dist/dependency-review/final/DevTeleport-dependency-review-preview.dmg`, SHA-256 `2a8d6d5d5f89e51f0802135d8ad1b68d88b0f68d0975ef1c3267a8b1b4d1467e`. All earlier generated-folder/ignored-file/live-console features remain included. Fresh 75 tests, source/final packaged desktop workflow, 44 architecture/integrity checks and 3 actual-DMG checks PASS. Checksums were generated and verified after final packaging. No publication or installation replacement occurred; this is still an ad-hoc 0.2.0 preview. Intermediate artifacts in `dist/dependency-review/desktop` are superseded by `final/`.

The receiver can review requirements before restoring, approve dependency installation once, then use the project's normal startup commands. This feature is in development source and the separate guided-restore preview build. The previously published npm 0.2.0 package and GitHub release asset have not been replaced.

## Desktop workflow

1. Choose the encrypted snapshot, passphrase and a **new** destination path.
2. Select **Restore and install dependencies**, then **Review restore**.
3. The preview lists detected packages, framework hints, declared dependencies, Node requirements, exact install commands, warnings and startup scripts. No destination is created and no installation runs during review.
4. Resolve any missing/incompatible system tools, conflicting lockfiles or unsupported package-manager requirements. Alternatively, leave installation off to recover files first.
5. Select **Restore & install**. DevTeleport authenticates/restores the files, installs the approved package dependencies, and verifies the captured files.
6. Open a terminal in the restored folder and use the commands shown under **Your startup guide**.

If installation fails or is interrupted, the current desktop source offers **Dependency recovery** to review and retry selected installations in the same restored folder. Read [Retry dependency installation](DEPENDENCY-RETRY.md) for the workflow, per-package statuses, approval requirements and current preview validation.

For a project with a separate CMS, the guide can show `npm run dev` in the main directory and `npm run develop` inside `cms`. Both independent packages receive their own dependency installation. DevTeleport does not automatically run application servers, choose arbitrary scripts, install system tools, start databases or generate credentials.

## Supported installation behavior

| Package | Install selected by the guide |
| --- | --- |
| npm with package-lock.json or npm-shrinkwrap.json | `npm ci --no-audit --no-fund` |
| npm without a lockfile | `npm install --no-audit --no-fund` |
| pnpm with pnpm-lock.yaml | `pnpm install --frozen-lockfile` |
| pnpm without a lockfile | `pnpm install --no-frozen-lockfile` |
| npm/pnpm workspace members | Shared install at their declared workspace root |
| Independent nested packages | Their own install using their detected/declared manager |
| Yarn, Bun, non-Node projects or unsupported workspace syntax | Manual setup; files-only restore remains available |

Installation may fetch packages and execute lifecycle scripts with the user's permissions. Existing package-manager build/script policies remain in force; DevTeleport does not bypass them. Without a lockfile, package versions are newly resolved and a lockfile is created. Dependency compatibility and application readiness are not guaranteed by a successful install.

The preflight checks available native Node/package-manager versions against supported engine ranges and explicit manager version declarations. Unknown ranges require manual review. Corepack and pnpm's own package-manager provisioning are disabled; projects requesting managed runtime downloads need manual setup. No Homebrew, system runtime or database installation is performed.

Environment hints list variable **names only** from included `.env.example`, `.env.sample` and `.env.template` files. Snapshots exclude `.env*` by default; the newer explicit **Include ignored files & secrets** capture option can include them and the real `.env`. Existing snapshots cannot recover previously omitted files; capture a new one with that option if needed. An existing directory's setup check can also read templates. These hints are not a complete missing-secret check. Configure destination-specific credentials separately when necessary, without assuming copied development secrets or dependencies will suit every machine. Installing dependencies after restoring captured node_modules can replace those files and cause verification differences; files-only restore preserves the captured files.

## CLI workflow

Use `node apps/cli/main.ts` in this checkout in place of `devteleport` until a new CLI package version is released:

```sh
devteleport restore project.dtp --target /path/to/new-project --install --dry-run
devteleport restore project.dtp --target /path/to/new-project --install --approve-execution

# Inspect/retry an existing restored project without restoring again:
devteleport setup /path/to/restored-project
devteleport setup /path/to/restored-project --install --approve-execution
```

`setup --dry-run` remains read-only even when installation flags are supplied. Explicit approval is still required for installation. Startup commands are drawn from declared `dev`, `dev:*`, `develop` and `start` scripts; there is no inferred arbitrary startup command.

## Recovery and safety

- Ordinary restoration remains files-only by default and keeps no-overwrite protections.
- Both format 1 and format 2 archives receive the dependency preview without changing their formats. Large format 2 payloads stay streamed; only bounded setup metadata is read into memory.
- Reviewed manifests/lockfiles are checked again before commands run, including between independent package installs. Symbolic-link package paths are refused.
- Snapshot passphrases are removed from installer environments. Raw script/registry output is withheld from diagnostics because it can contain credentials; errors identify the package and explain how to retry from a trusted terminal.
- Install failure or cancellation preserves restored files and earlier successful installs. The journal remains at files-restored on failure. There is no cross-package rollback.
- Cancellation uses the existing process-group supervisor to terminate lifecycle descendants.

## Validation

The current follow-up records its checks in `dist/guided-restore/` and `dist/evidence/guided-restore.json`. Validation uses disposable fixtures, including actual npm dependency installation, startup commands after source removal, a mixed pnpm/npm project and failure/cancellation cases. It does not certify every npm package, framework, runtime or native build.

Fresh local results on 2 November 2026: strict checks PASS; **58 tests PASS, zero skips/failures**, including 12 setup/recovery cases; actual source desktop restore/install/startup commands PASS; separately packaged ARM64 desktop smoke PASS; **32 packaged dark/light layout combinations PASS**, zero renderer errors; architecture/resource inventory **42 checks PASS**; actual-DMG validation **3 checks PASS**. Real mixed pnpm 12.11.2/npm 11.19.0 installation and frozen-lock retry both passed with offline disposable fixtures. This proves local installation/linking and lifecycle/startup behavior, not registry availability or actual Strapi compatibility. The visual fixture labels Strapi from its declared dependency; it does not download or run Strapi.

The existing two-app TLS transfer and independent restore regression also passed on the same host. The first packaged smoke attempt timed out while clicking the welcome button; a fresh isolated-profile retry completed the full workflow. The cause of that interaction timeout was not established. The consolidated 19-stage gate and hosted CI were not rerun by this session for this feature; their previous recorded results describe earlier source.

Preview DMG: `dist/guided-restore/desktop/DevTeleport-guided-restore-preview.dmg` (SHA-256 `34f1cfdda48bececb4463957f989ce188fd6b04778d19ed6d7c5362b7737547b`). ZIP and verified checksums are alongside it / in `dist/guided-restore/SHA256SUMS`. Its bundle remains version 0.2.0 for this local preview; it must receive a new version before public release. The preview is ad-hoc sealed, without Developer ID signing/notarization. Existing Applications installations and the old published DMG were preserved.

Command behavior references: [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/), [pnpm install](https://pnpm.io/cli/install), [pnpm manager version handling](https://github.com/pnpm/pnpm.io/blob/main/docs/settings/cli.md).
