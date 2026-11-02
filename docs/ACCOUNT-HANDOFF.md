# DevTeleport — complete development handoff

LATEST DEPENDENCY REVIEW (2 November 2026): real user restore review said packages=0 plus generic metadata blocker. Source project has settings-only pnpm-workspace.yaml (minimumReleaseAgeExclude, no packages). Planner now supports literal settings-only / packages: [] as root-only; nested npm stays independent. Controlled DependencyReviewError messages expose metadata path, never raw parser body; complex/unsupported YAML still blocks and managed runtime restrictions remain. Desktop blocked install review is Needs attention in main panel/console, logs reasons, disables Restore & install, avoids the false zero-package/no-supported/automatic-install wording, preserves files-only recovery. 75 tests and source desktop PASS; actual source plan has two install locations (root pnpm frozen lock and nested npm ci), zero local tool/runtime blockers. Did not decrypt user's archive, execute project installs or modify its data. Existing snapshots need no recapture. Source desktop initially failed only in new fixture construction/navigation assertions, corrected to an actually captured nested malformed manifest and an unambiguous button selector; final test PASS. Evidence `dist/dependency-review/`. Consult latest STATUS.md/GUIDED-RESTORE.md for final packaged validation; preserve earlier feature work. Public artifacts/installations unchanged; preview still bundle 0.2.0 requiring a new version before public release.

Latest generated-folder follow-up (2 November 2026): user hit the 50,000-entry limit with Include ignored files & secrets. Separate off-by-default, nonpersisted **Skip dependencies & build caches** / `--exclude-generated` excludes directory names node_modules/.next/.nuxt/.svelte-kit/.turbo/.cache/dist/build/coverage recursively while retaining eligible .env/ignored data. It records optional authenticated capturePolicy.excludeGenerated, is validated in both formats, respected by directory diff and described in restore warnings; old metadata remains accepted. Exact public 0.2.0 reader restored both new formats after source removal; intermediate development previews with strict old policy validation may need updating. Review changes invalidate approval; no limits or overwrite protections were relaxed. The user's actual project passed read-only review with 711 entries/31,029,787 bytes and environment filenames retained; no capture/install/project changes occurred. Fresh 72 tests/source+packaged desktop/32 layouts/44 architecture+integrity/3 DMG checks PASS. New preview: dist/generated-folders/desktop/DevTeleport-generated-folders-preview.dmg, SHA-256 a943f50243e69e5718ab9b07695402cecf4a158e9f9a84f98f881e730a63f006; checksums verified after packaging. Evidence dist/evidence/generated-folders.json and dist/generated-folders/. Existing running old app/installed apps/public release were not replaced; still ad-hoc bundle 0.2.0, needs new version before publishing. No fresh full consolidated gate/hosted CI claimed. Read latest STATUS.md and INCLUDE-IGNORED.md; preserve newer changes.

Latest ignored-file capture follow-up (2 November 2026): user explicitly requested a checkbox to copy `.env` and everything ignored by Git. Implemented off-by-default **Include ignored files & secrets** / CLI `--include-ignored` / API `includeIgnored`. With explicit opt-in, capture bypasses Git/default exclusions and embedded-secret filtering inside the workspace; manual exclusions and protected Git/DevTeleport metadata, limits, symlink/path checks remain. Capture review shows environment filenames without bodies; both capture and restore warn about secrets. Changing the checkbox invalidates the review. Both formats record optional authenticated `capturePolicy.includeIgnored`; diff follows that policy, and older metadata remains supported. Create new snapshots to include previously omitted files. Copied native dependencies may need rebuilding. Read docs/INCLUDE-IGNORED.md.

Fresh local results: 70 tests/strict checks PASS, source and packaged desktop full workflow PASS, >64 KiB file-list response / 600 Unicode filenames PASS, 32 packaged layouts PASS with zero renderer errors, 43 architecture/integrity and 3 actual-DMG checks PASS, same-host two-app transfer/restore PASS. Exact original published CLI/core 0.2.0 tarball restored new opt-in archives in both formats after source removal. The larger preview exposed an exit/stdout race; main now awaits stream completion and decodes UTF-8 across chunks before JSON parsing. Evidence: dist/evidence/include-ignored.json and dist/include-ignored/. New local preview DMG SHA-256 dc48f1772ad28afb9939e2830f6f8fc5907f3b495e96c9cec9709b9d2609aad1 at dist/include-ignored/desktop/DevTeleport-include-ignored-preview.dmg. Published artifacts/installations were preserved. Preview is still bundle 0.2.0, ad-hoc only; assign a new version before public release. Prior full-gate/hosted results are historical. Preserve newer commits/docs and existing website work.

Latest live-console follow-up (2 November 2026): the user clarified they want **live progress and terminal-style output**, not visual controls for every CLI command. Implemented the shared desktop workspace console: actual command arguments, operation steps, live filtered installer stdout/stderr, timestamps/elapsed time, results, cancellation/error states, auto-follow, bounded 500-event tail, copy and explicit private no-overwrite export. Existing approvals and archive formats are unchanged. No interactive shell or automatic logging was added. Filtering is best-effort; local paths/unknown private application data can remain, so sharing requires review. Read [LIVE-CONSOLE.md](LIVE-CONSOLE.md).

Fresh checks: 64 tests / strict checks PASS; source and final packaged desktop console/copy/export/cancellation PASS; 32 packaged layouts PASS with zero renderer errors; 43 architecture/integrity and 3 actual-DMG checks PASS; same-host two-app transfer/restore PASS. One rebuilt packaged test's expected-error message assertion failed; diagnostic isolated retry passed, cause not established. Earlier consolidated/hosted results are historical. Evidence: `dist/evidence/live-console.json`, `dist/live-console/`. Final local preview DMG SHA-256 `b037c77340027957567f8d50b00ed06077151b52c2c1940b5e68ed48c04f9b98`, path `dist/live-console/desktop/DevTeleport-live-console-preview.dmg`. Public 0.2.0 downloads and installed apps were not replaced; preview bundle version remains 0.2.0 and needs a new version before public release. Preserve newer commits and reporting edits.

Latest follow-up (2 November 2026): read [GUIDED-RESTORE.md](GUIDED-RESTORE.md) and the latest STATUS.md section. Receiver restore now previews npm/pnpm requirements, installs approved dependencies across independent subprojects/workspaces, and displays startup commands. Both archive formats are supported; unknown/missing tools or unsupported managers block automatic execution while files-only recovery remains available. Secrets/system runtimes are configured separately. Failed/cancelled installs preserve recovered files and earlier successful installs. New `setup DIR [--install --approve-execution]` supports inspection/retry in an existing directory. Preserve the existing execution approvals and tool provisioning guards.

Fresh local evidence: 58 tests / strict checks PASS, source and packaged desktop guided restore/startup PASS, 32 packaged UI layouts PASS, architecture/integrity 42 PASS and actual-DMG validation 3 PASS; actual mixed pnpm/npm install and frozen retry PASS with offline fixtures. One initial packaged onboarding click timed out; fresh-profile retry passed. No fresh full 19-stage gate or hosted run is claimed for this feature. Evidence: `dist/evidence/guided-restore.json`, `dist/guided-restore/`. Separate candidate DMG: `dist/guided-restore/desktop/DevTeleport-guided-restore-preview.dmg`, SHA-256 `34f1cfdda48bececb4463957f989ce188fd6b04778d19ed6d7c5362b7737547b`; ad-hoc only. Published npm/GitHub 0.2.0 artifacts and existing installations were preserved. The local preview retains bundle version 0.2.0; assign a new public version before release. Inspect current Git status/HEAD: commits advanced during implementation; preserve newer work and reporting edits.

Prepared 2026-10-31 for continuing this project in another development session/account. This document is self-contained project context; read the source and evidence before making fresh claims.

## Where we are and whether we reached the goal

We reached a working, packaged, locally tested native Apple Silicon release candidate. We have not reached the full production-ready distribution goal. The core capture/transfer/restore product exists, preserves the tested MVP functionality, and passed the documented local verification. Signing, physical-device acceptance, reliable signed update installation and release verification remain unfinished. Do not assign a misleading percentage: several remaining gates require credentials, hardware or external execution rather than more ordinary implementation.

The original objective was a local-first tool that captures a developer workspace into an encrypted portable snapshot, transfers it, and reconstructs supported source/Git/database/container/editor state independently. The follow-up objective added native Apple Silicon execution, bounded-memory large snapshots, a polished desktop, secure LAN transfer, recovery, and production distribution preparation. This is reconstruction of supported saved state, not migration of running processes or every possible development environment.

## Repository checkpoint

- Workspace: `/Users/atulenv/Desktop/hacktober`.
- Origin: `https://github.com/atulvjd/devteleport.git`.
- HEAD inspected for this handoff: `e855858dd6868813a849eff23b6244c8eaea4e6e`.
- Commit subject: `All Test cases pass, checking phase at 1.0.0`.
- Actual package version is **0.2.0**. The commit subject does not establish a 1.0 release.
- Working tree was clean before creating these handoff files. This handoff introduces documentation only; inspect current `git status` before resuming.
- Stable application identifier: `dev.devteleport.desktop`.
- The previous agent did not push, publish, upload for notarization or execute remote CI. User activity outside that session is not established; inspect remote state if needed and authorized.
- Primary app: Electron desktop, shared TypeScript core and CLI, public-API VS Code extension. No framework rewrite is needed.

## Implemented functionality

| Component | Current implementation and evidence boundary |
| --- | --- |
| Encrypted snapshots | Scrypt + AES-256-GCM, integrity checks, authenticated parsing/extraction, exclusive publication, no overwrite |
| Format compatibility | Original format 1 reader/writer retained; CLI/desktop default to streaming format 2; library API retains format 1 default unless `{format:2}` is selected |
| Large payloads | Format 2 streams file/database bodies with bounded metadata/buffers; private plaintext staging needs disk space |
| Git | Standalone repository history/index, staged/unstaged/untracked/deleted files, modes, detached/unborn HEAD cases and locally complete LFS; unsupported layouts refused |
| PostgreSQL | Opt-in custom dumps, stream-to-disk support, table exclusions, explicit external destination mappings, version checks, nonempty-target refusal and transaction per database |
| Docker | Reviewed Compose startup and stopped plain local named-volume backup/restore; target ownership/no-overwrite and bounded safe extraction |
| Transfer | TLS 1.3, explicit sender/receiver approval, certificate/fingerprint descriptor pairing, protected bearer token, timeout/expiry, streamed encrypted upload and resume |
| Recovery | Durable private-stage journals, process-group cancellation, inactive-stage cleanup preview and explicit approval |
| Desktop | Real dashboard/history, inspector, capture/restore review, snapshot labels/unlock/export/Trash, transfer, diagnostics, nonsecret settings, onboarding, themes, menus, icon, license/privacy and window restoration |
| Native tools | PATH/Homebrew/version-manager/app discovery and ARM64 executable checks; desktop backend runs within Electron without separately installed Node |
| VS Code | Real extension-host workflows, workspace trust, dirty-buffer approval, saved-tab reopening, status/cancellation, desktop launch and machine/user-scoped executable settings |
| Updates | Trusted Ed25519-signed release metadata validation; automatic executable replacement disabled |
| Distribution | CLI tarball, VSIX, ARM64 DMG/ZIP, checksums, unsigned/signed build separation and signing preflight |

## Verification already performed

The saved consolidated run completed at `2026-10-30T22:54:24.799Z` (2026-10-31 in Asia/Kolkata). `dist/evidence/apple-silicon-verification.json` reports **17 PASS, zero FAIL, zero SKIPPED**, with separate blocked release gates. These are saved results, not newly rerun tests during handoff preparation.

The stages cover native host/Node, strict types, 30 core/security/format tests, TLS transfer, signed-update HTTPS, two-Electron transfer, PostgreSQL, PostgreSQL version compatibility, live Docker, combined independent Express/Git/database/Compose restoration, CLI packaging/installed executable, VSIX packaging, actual trusted and untrusted editor hosts, bundle architecture/integrity, and packaged desktop.

Actual reference hardware: **Apple M4, 16 GiB RAM**, native arm64 Node 24.21.0. Actual Electron main and utility backend were arm64. Fourteen packaged Mach-O executables/helpers/frameworks were inspected. Backend/UI hashes and bundle version were checked. There are no production native npm addons. M1/M2/M3 compatibility is an intended ARM64 target, not separately measured physical-device evidence.

An additional installed-app smoke passed from `/Applications/DevTeleport 0.2 RC.app`, with isolated user data, encrypted capture, source removal, independent restore/verification and window bounds restoration. The old `/Applications/DevTeleport.app` 0.1 app was preserved. A local installed-app launch does not establish acceptance for downloaded/quarantined distribution.

`npm run verify:signing` exited 2, with codesign, Gatekeeper and notarization ticket checks **BLOCKED**. This is a real release blocker, not a test to disable.

Earlier Linux and Rosetta/x64 work exists in historical documentation; do not claim it certifies the final 0.2 source on a physical Intel/Linux host. The final consolidated evidence is native ARM64 macOS.

## Measured performance

| Observation on M4 / 16 GiB | Saved result |
| --- | --- |
| 1 GiB compiled-engine capture | 2.707 s |
| 1 GiB compiled-engine restore | 2.176 s |
| Peak capture RSS | 191,520 KiB |
| Peak restore RSS | 176,320 KiB |
| 256 MiB desktop capture | 1.330 s |
| Fresh process/profile onboarding | 607 ms |
| Sampled aggregate Electron working-set peak | 559,040 KiB |
| Renderer two-frame samples during capture | Approximately 12–33 ms |

Generated fixture used a repeated random block, OS caches were not cleared, other system activity was uncontrolled, and aggregate memory can double-count shared pages. Source was removed before recovery and hashes matched. These numbers are observations, not universal throughput or physical-network benchmarks. Read `dist/evidence/performance.json` and `desktop-performance.json` for methodology.

## What is left, in priority order

### 1. Finish reliability and manual acceptance that can be done locally

Expand the failure matrix around capture/authentication/extraction/publication and approved database/volume/install/service phases. Existing tamper, forced interruption, process cancellation and transfer-resume tests do not cover every phase. Test disk exhaustion, permissions, tool failures, abrupt termination, retry and evidence preservation using disposable fixtures. Define the expected state of each component after failure; do not invent distributed rollback. Add tests for actual uncovered defects and keep existing protections.

Perform manual desktop acceptance on representative projects: keyboard navigation/accessibility, long paths, large libraries, readable errors/recovery, missing-tool onboarding, clean settings, themes, launch/relaunch and actual optional notifications. Review developer-facing help against the new commands: the CLI's compact usage text was observed to omit some new commands even though implementations and detailed docs exist. This is a small follow-up documentation/usability item, not proof of missing implementations.

Completion evidence: explicit scenarios, outputs/screenshots where useful, discovered fixes and regression results. No production certification solely from automation.

### 2. Validate two physical Macs

Needs a second Mac and a reachable network. Use disposable projects with source/Git changes, and optionally approved PostgreSQL/volume mappings. Compare fingerprints, receive to a new destination, authenticate/restore independently and verify file/Git/application behavior. Test network interruption, sender retry, receiver restart/new pairing, expiry, wrong pairing and existing target refusal. Record both machines, OS versions, architecture, sizes, timings and outcomes. Validate OS LAN/firewall permissions through the normal user workflow.

Existing localhost tests prove actual TLS and two real app processes; they do not prove cross-device discovery/routing/permissions. Manual addressing is implemented; Bonjour discovery is not.

### 3. Sign and notarize a release

Needs authorized Apple Developer ID signing credentials and notarization access. Do not paste secrets into documentation/chat or commit them. `scripts/signed-release.mjs` checks prerequisites and enables hardened runtime, entitlement configuration and notarization; default builds stay explicitly unsigned. Run only with authorization because notarization uploads an artifact externally.

Completion evidence: signed app/installer with expected identity, successful strict signature validation, Gatekeeper assessment and stapled notarization ticket; fresh downloaded-install acceptance. Do not bypass validation or mark missing credentials as success.

### 4. Complete secure update installation

The metadata verifier exists; download/install/restart recovery is not complete. Provide a trusted release feed/key and signed/notarized artifacts first. Design and test artifact digest/signature/identity validation, version/rollback policy, atomic replacement, failure recovery and restart on real signed builds. Keep installation disabled until these checks pass. Do not enable unsigned automatic updates as a shortcut.

### 5. Run remote CI and prepare distribution

Workflows are configured for cross-platform core tests, service integrations and ARM64 application packaging/verification. Local results do not prove hosted workflows pass. Inspect current remote state, obtain authorization for any required push/workflow execution, fix real failures and retain logs/artifacts. Review release contents/checksums/version before a separately authorized publication.

### 6. Broaden assurance and platform evidence

Independent security review and a broader device/filesystem/project matrix remain useful assurance work. Physical Intel, additional M-series devices and Windows are not certified by the current ARM64 test. Scope extensions should be explicit; do not silently turn this handoff into a rewrite or universal environment migrator.

## Important support and security limits

- Format 2: 16 GiB individual file/database payload, 32 GiB aggregate bytes, 16 MiB metadata and 50,000 entries. The 1 GiB benchmark does not demonstrate full-limit operation.
- Named-volume adapter remains limited to 32 MiB compressed and 128 MiB expanded data with bounded members. Large-project streaming does not enlarge volume support.
- Format 1 remains memory-bound with its original limits; do not loosen its decoder to claim format 2 capacity.
- Standalone Git only. Linked worktrees, submodules, nested/partial/shallow/alternate layouts have explicit limitations/refusals. Preserve that behavior until safe support is designed.
- No arbitrary bind mount or external volume-driver migration, Docker image transport, live database-volume consistency, process/RAM migration, terminal replay or arbitrary extension-state migration.
- Only saved editor state is represented. Do not promise unsaved buffer recovery.
- Secret detection is selective, not universal. Git history, databases and selected volumes may contain sensitive data. Encrypted snapshots still need strong passphrases and trusted handling.
- Private plaintext staging can remain after abrupt crashes. It is permission-restricted, not guaranteed erased. Review recovery previews before cleanup.
- Restored files, SQL, npm lifecycle scripts and containers have different trust/execution boundaries. Preserve explicit approvals and external target mapping.
- Existing target directories/databases/volumes must not be deleted or reused to make an operation pass.
- No distributed rollback across filesystem/PostgreSQL/Docker. Partial success must be reported accurately.
- Pairing descriptors contain authorization secrets; never include them in logs, handoff bundles or public issues. Fingerprint comparison and trusted exchange are required.

## Source map for the next engineer

| Path | Responsibility |
| --- | --- |
| `packages/core/index.ts` | Shared engine, inspect/enumerate, format 1, verification and adapter orchestration |
| `packages/core/stream-v2.ts` | Format 2 streamed capture/authentication/restore |
| `packages/core/postgres-stream.ts` | Streamed database dumps/restoration/version checks |
| `packages/core/docker.ts` | Compose/local-volume adapter and extraction boundaries |
| `packages/core/transfer.ts` | TLS pairing, encrypted uploads, resume and publication |
| `packages/core/platform.ts` | Executable discovery and native diagnostics |
| `packages/core/processes.ts` | Spawn supervision, native guards, process-group cancellation |
| `packages/core/recovery.ts` | Journal inspection and approved inactive-stage cleanup |
| `packages/core/updates.ts` | Signed release metadata and trusted source validation |
| `packages/core/atomic.ts` | Bounded reads and no-clobber publication |
| `packages/core/signatures.ts`, `lfs.ts`, `types.ts` | Detached signatures, LFS checks and shared types |
| `apps/cli/main.ts` | CLI source; edit this rather than generated `dist/backend/apps/cli/main.js` |
| `apps/desktop/` | Electron main/preload/renderer, styles, builder and entitlements |
| `apps/vscode-extension/` | Extension implementation/manifest |
| `tests/`, `scripts/` | Unit/integration/native GUI/editor tests, build/release/benchmark tools |
| `.github/workflows/ci.yml` | Prepared remote workflows |
| `docs/FORMAT-2.md`, `NETWORK-TRANSFER.md`, `SECURITY.md` | Authoritative format/protocol/security boundaries |

Generated `dist/backend` files are overwritten by `npm run build:backend`; do not fix source bugs there. Old npm debug logs in `dist/.npm-cache/_logs` are historical diagnostics. Use timestamps and reproduce a failure before treating one as a current blocker.

## Working commands and local prerequisites

Node 24+ is required. Recorded native environment had Homebrew at `/opt/homebrew`, PostgreSQL 15 tools at `/opt/homebrew/opt/postgresql@15/bin`, running Docker Desktop, and VS Code Insiders at `/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders`. Rediscover tools on another machine instead of hardcoding these paths. The PostgreSQL version test expects the documented older host dump client and uses real Docker containers. Native GUI/service tests require corresponding local execution permissions.

```sh
cd /Users/atulenv/Desktop/hacktober
git status --short
node -p 'process.platform + " " + process.arch'
npm run check
npm test
npm run desktop
```

For a fresh checkout use `npm ci` to install pinned dependencies. For a candidate after source changes:

```sh
npm run package:desktop -- --publish never
npm run verify:apple-silicon
npm run checksums
shasum -a 256 -c dist/SHA256SUMS
npm run verify:signing
```

The consolidated gate builds/tests CLI and VSIX, but expects a separately built desktop bundle. It does not silently install missing service prerequisites. Required skipped stages prevent overall runtime success. Signing is a separate gate and currently expected to exit 2/BLOCKED.

Targeted commands include `test:stream`, `test:processes`, `test:transfer`, `test:updates`, `test:postgres`, `test:pg-versions`, `test:docker:live`, `test:full`, `test:desktop`, `test:desktop:transfer` and `test:vscode` via `npm run`. Use targeted tests for a change, then full candidate verification when rebuilding a release.

Reproduce benchmarks with `DEVTELEPORT_BENCH_MIB=1024 npm run benchmark` and `npm run benchmark:desktop`. Benchmarking overwrites evidence, so retain the old observation if comparing revisions.

## Existing artifacts and evidence

All paths below are relative to `/Users/atulenv/Desktop/hacktober` unless absolute:

- `dist/desktop/DevTeleport-0.2.0-apple-silicon-unsigned.dmg`
- `dist/desktop/DevTeleport-0.2.0-apple-silicon-unsigned.zip`
- `dist/devteleport-0.2.0.tgz`
- `apps/vscode-extension/devteleport-0.2.0.vsix`
- `dist/SHA256SUMS`
- `dist/evidence/apple-silicon-verification.json` and its `verify-*.log` files
- `dist/evidence/architecture.json`, `signing.json`, `applications-install.log`
- `dist/evidence/performance.json`, `desktop-performance.json`
- `dist/native-runtime.json`, `dist/desktop-smoke.png`, `dist/desktop-light.png`
- Installed candidate: `/Applications/DevTeleport 0.2 RC.app`

**Git excludes `dist/`, `*.vsix`, `*.dtp` and `node_modules/`. A clone alone will not carry installers, measured evidence or snapshots.** Preserve selected evidence/artifacts separately if changing machines. Do not copy private snapshots, pairing descriptors, passwords, keys, database credentials or npm cache logs into a general handoff bundle.

Reports added after packaging are not necessarily inside the existing app's bundled documentation. The working repository's current handoff is authoritative for continuation; rebuild artifacts after future source/release changes.

## Transfer context to the next session

For a development session with filesystem access, open this same repository and provide `docs/NEXT-SESSION-PROMPT.md`. For a text-only session, attach or paste this handoff plus `docs/FINAL-REPORT.md`; provide relevant source when requesting implementation review. A prompt by itself is not the codebase.

Read in this order: this document, `FINAL-REPORT.md`, `STATUS.md`, `ARCHITECTURE.md`, `SECURITY.md`, `FORMAT-2.md`, `NETWORK-TRANSFER.md`, then the original requirements in `docs/requirements/` when present. `MVP-README.md` is historical. Do not repeat obsolete claims that network transfer is absent or no origin is configured.

Next action recommended: confirm checkpoint/evidence, audit the uncovered recovery/failure and manual-acceptance matrix, complete actionable local work, then request only the concrete missing hardware/credential/publication resources. Preserve all tested capabilities and record exact results. The next agent should implement and validate, not merely produce another plan.


## Recovery follow-up — 2026-10-31

Fixed approved cleanup ordering so failure to remove a partial archive preserves the staging journal needed for retry. Added two injected filesystem-failure regressions. Fresh strict checks and all 32 tests passed with zero skips. See [RECOVERY-VALIDATION.md](RECOVERY-VALIDATION.md) for exact scenarios and remaining coverage. Earlier 30-test results above describe the preceding checkpoint. The existing installed `/Applications/DevTeleport 0.2 RC.app` has not been replaced by this follow-up; use newly rebuilt artifacts for the fix.

Fresh rebuilt ARM64 candidate verification completed at 2026-10-30T23:14:27.597Z: all 17 consolidated stages PASS, zero required skips/failures. CLI, VSIX, unsigned DMG/ZIP and `dist/SHA256SUMS` were regenerated. Signing, physical-device acceptance and remote CI remain separate unresolved release gates.


## Contributor test-report fixes and diff integration

Applied reviewed PR #2 test-harness fixes and PR #1 diff functionality locally, then strengthened startup-output parsing/cleanup and added five parser regressions. The colour-enabled suite now has 46 passing tests, including all existing recovery tests and nine diff tests. Express/full recovery and all three live Docker tests passed with FORCE_COLOR=1; Python 3.13.18 accepted the repaired header-only fixture. Remaining core CI macos-14 label moved to macos-15 and affected CI tests explicitly exercise colour output. Fresh rebuilt native verification passed all 17 stages; artifacts/checksums refreshed. No remote merge, push or hosted CI execution was performed. See [TEST-REPORT-FOLLOWUP.md](TEST-REPORT-FOLLOWUP.md) for exact reviewed heads, changes, commands and evidence. Earlier 30/32-test reports are historical checkpoints.


## Downloaded-app packaging correction

A shared app was reported as damaged although its DMG mounted. Local inspection confirmed an invalid packaged app resource seal. Development packaging now explicitly ad-hoc signs the app and helpers, and bundle verification checks that seal. A new actual-DMG mount/signature check is included in the native gate and CI. Fresh rebuilt verification passed **18 stages** with **46 tests**, and checksums were refreshed. Code/resource integrity now passes; Developer ID, Gatekeeper and notarization remain BLOCKED. This is not proof that the friend’s downloaded installation is accepted. See [DISTRIBUTION-VALIDATION.md](DISTRIBUTION-VALIDATION.md) for diagnosis, artifact hashes and remaining trust gates. The filename still says unsigned because the app is not Developer ID signed/notarized. Existing Applications installations were not replaced.


## Desktop UI refresh — latest candidate

Reworked desktop navigation, typography, vector icons, dark/light themes and responsive layouts. Capture now distinguishes included files/Git from configured optional components; review summaries are readable, final actions require a valid matching review, restore mapping is disclosed when needed, progress/errors are summarized, and technical details stay available. Theme changes persist, window startup matches the theme, passphrase visibility is explicit, and restored-project opening is limited to the verified current target.

Fresh rebuilt verification: **19 stages PASS**, **46 core/security/diff/parser tests PASS**, and **32 packaged UI layout combinations PASS**, with zero renderer errors or required skips. Screenshots were inspected; actual-DMG code/resource seals and regenerated checksums passed. Installers include the new UI; existing Applications installations were preserved. See [UI-REFRESH.md](UI-REFRESH.md) for changes, commands, evidence and remaining manual acceptance limits.


## Public npm CLI release — 31 October 2026

**Published and independently verified:** `devteleport@0.2.0` is public at https://www.npmjs.com/package/devteleport with latest tag `0.2.0`. Anyone with Node.js 24+ on macOS/Linux can run `npm install -g devteleport`; no repository or desktop is required. Exact registry SHA-512 matched the approved tarball. A fresh public-registry global install with an empty cache passed help/inspect/capture/diff/source-removal/restore/original-archive verification. See [NPM-RELEASE.md](NPM-RELEASE.md) and `dist/evidence/npm-public-install.json`. Earlier pending/authentication-blocked statements are historical and superseded. No desktop publication, Git push, remote merge or remote CI execution occurred. Future CLI changes need a new package version; do not republish 0.2.0.

## Latest GitHub release / CI correction — 31 October 2026

The sole final DMG is now published at https://github.com/atulvjd/devteleport/releases/tag/v0.2.0. The release source commit is `11923f028e4ec88df9bfd271b8f593aa27a491f3`. The tag push triggered hosted run #22: three core jobs and Linux integrations passed, but applications failed because a 1080-pixel smoke window exceeded the hosted 1024-pixel display. Later application stages were skipped. Earlier no-publication/no-hosted-run statements are historical; see the latest section of [STATUS.md](STATUS.md).

The user's screenshot is from the older smoke source (line 72), whose renderer could expose the previous configuration error before an async settings save finished. Current release/local renderer already enters busy synchronously. Local smoke now deliberately holds that save, waits for control release, and tests window persistence with bounds that fit the display while keeping exact saved/reopened equality assertions. Strict checks, source smoke and existing packaged ARM64 smoke passed; a disposable old-ordering regression failed as intended. Evidence: `dist/evidence/desktop-ci-followup.json`. This follow-up changes tests/docs only and does not modify the published DMG.

Main advanced during this work to `dc2faa4b40092ccaf8e5ade1b567c78563b32c24`, including these corrections. **Hosted run #23 passed all five jobs** at `2026-10-31T04:42:48Z`: https://github.com/atulvjd/devteleport/actions/runs/41169471448. This includes ARM64/Intel macOS and Ubuntu core checks, Linux integrations, source desktop, two-app TLS, both VS Code trust modes, packaging, actual-DMG integrity, architecture, packaged smoke and 32 UI layout combinations. Hosted artifact `unsigned-applications` ID is `13031020126`. The published release tag/DMG were preserved. Only final reporting/comment edits remain local; inspect current Git status. Signing/notarization, physical two-Mac acceptance and secure update installation still need separate work; a green workflow does not certify those gates.
