# Implementation status — 2026-10-31

Implemented in an initially empty workspace. Local validation used macOS arm64 and Node 24.21.0. No physical two-machine transfer, Intel execution, Linux execution, Windows execution, remote CI run, code signing, notarization or publishing was performed.

## Deliverables

| Deliverable | Status | Evidence / boundary |
| --- | --- | --- |
| CLI | Implemented and tested | Real subprocess capture/restore/verify lifecycle; portable npm tarball |
| Capture and restore engine | Implemented and tested within limits | Independent destination after source removal; double-read change detection, new destinations only |
| Versioned snapshot format | Implemented and tested | Strict format 1 reader; unsupported versions rejected; future migration policy documented |
| Encryption and integrity | Implemented and tested | Scrypt + AES-256-GCM, per-payload SHA-256, wrong-password and corruption failures; no public-key signatures |
| Git preservation | Implemented and tested for standalone repositories | Index, objects, HEAD, staged/unstaged/deleted/untracked files, unborn and detached HEAD; local config/hooks/remotes omitted |
| PostgreSQL | Implemented and integration tested on PostgreSQL 15 | Real dump, removal of source DB, restore, record query and nonempty-destination refusal; localhost only |
| Docker Compose | Partially supported and configuration tested | Real Compose parsing, images/ports/dependencies/mount projection and reviewed command; no volume/image backup or automatic startup |
| VS Code extension | Implemented and VSIX packaged; runtime unverified | Five commands, sidebar, public saved-tab metadata APIs; needs actual VS Code extension-host validation |
| Desktop app | Implemented and automated workflow tested | Actual Electron controls: inspect, review capture, encrypted capture, restore after source deletion, verify; source and packaged arm64 app tested; screenshot generated |
| Snapshot history | Implemented | Lists actual encrypted snapshot files with size/time; unlock for content details; no global database/index |
| Verification | Implemented and tested | File hashes, types, safe links and permissions; Git index cache refresh is checked against staged entries; local editable inventory is not a signature |
| Test suite | Implemented and locally run | 13 core tests, separate PostgreSQL, Docker config and Express integration cases, and desktop automation |
| Documentation | Implemented | README, architecture/format, security, troubleshooting, contributor/release, example, and this status matrix |
| Build/install scripts | Implemented and artifacts generated | Installed CLI tgz smoke-tested, VSIX, unsigned arm64/x64 macOS DMGs; no bundled external Node backend |
| CI | Configured, not remotely run | macOS/Linux matrix, database/Compose/Express checks, artifact build/upload jobs |
| Example app | Implemented | Express server, package manifest, Compose PostgreSQL configuration and database adapter example |
| Support/limitations matrix | Implemented | This document plus security/architecture details |

## Observed validation

- `npm run check`: passed baseline TypeScript checking and desktop/extension JavaScript syntax checks. Strict TypeScript mode is not enabled.
- `npm test`: 13 core tests passed, zero failures/skips. Coverage includes actual Git/CLI restoration, secrets/dependency exclusions, safe-path/schema attacks, incorrect passphrase, archive tampering, size limits, approval gates and exact permission restoration under restrictive umask.
- `npm run test:postgres`: passed with a real temporary PostgreSQL cluster, real custom-format dump and restore. The sandbox initially denied PostgreSQL shared memory; the same test passed outside that sandbox. No preexisting database was modified.
- `npm run test:docker`: passed real Docker Compose configuration analysis without a daemon. No containers were started; the Docker daemon was unavailable.
- `npm run test:e2e`: passed a real HTTP request to independently restored Express code after deleting the original project, reinstalling dependencies with explicit approval, and checking uncommitted/untracked Git state.
- `npm run test:desktop`: passed actual Electron UI controls and generated `dist/desktop-smoke.png`. Launch requires removing the host's `ELECTRON_RUN_AS_NODE` flag; the automated runner does so explicitly.
- `npm run test:package`: passed actual offline global tarball installation in a temporary prefix and execution from `node_modules`. Packaging emits JavaScript because Node forbids native type stripping inside installed dependency directories.
- `npm run package:cli`, `npm run package:extension` and `npm run package:desktop -- --publish never`: generated local artifacts. DMGs are unsigned and not notarized.
- Dependency installation/audit after upgrading Electron reported zero known vulnerabilities at that time. This is not a permanent or independent security certification.

The combined `npm run test:full` case passed real CLI capture/restore of Express, Git changes, PostgreSQL records and Compose configuration, removed both source project and source database, installed approved dependencies, and verified a database-backed HTTP response. This is independent-directory/database testing on one host, not physical two-device testing. Docker containers were not started. The GUI test covers file reconstruction; it does not test graphical PostgreSQL restore or VS Code extension behavior.

## Platform support

| Platform | Local evidence |
| --- | --- |
| macOS Apple Silicon | CLI, Git, PostgreSQL, Compose analysis, Express and desktop workflows tested |
| macOS Intel | Installer generated; execution and physical-machine validation pending |
| Linux | Core is designed around compatible POSIX APIs; CI configured; not locally run |
| Windows | Unsupported until a separately tested path/permissions/process implementation exists |

## Remaining work

1. Validate the VSIX in actual VS Code, including workspace trust, saved tab restoration and all cancellation/error paths.
2. Run signed-off physical Apple Silicon-to-Intel and Intel-to-Apple Silicon transfers with the source offline; verify native package reinstall behavior.
3. Run Linux CI and validate generated installers on their target architectures. Sign/notarize only with authorized credentials.
4. Extend the passing combined Express/Git/PostgreSQL/Compose-analysis fixture with Docker daemon service startup verification; keep volume backup claims disabled until adapters exist.
5. Bundle an appropriate backend Node runtime for standalone desktop distribution; add persistent settings, cancellation, progress phases and a richer restore wizard. Current desktop requires external Node 24.
6. Add PostgreSQL table/schema exclusion policy, explicit server-version preflight and broader version testing. Current utility compatibility failures stop the operation, but no multi-version compatibility certification exists.
7. Add explicit volume backup adapters, LFS completeness checks, and separately scoped Git worktree/submodule/nested repository support. LFS object data is included only when it exists locally; missing objects are not downloaded or guaranteed.
8. Add streaming bounded snapshots, richer configuration validation, strict typing, journaling for interrupted capture/restore and broader race/fault-injection tests. Current archives are memory-bound and hard-limited.
9. Improve detection of secrets embedded in arbitrary file content, provide opt-in signing and authenticate inventories against the original archive.
10. Keep transfer file-based until a separately tested authenticated pairing/resume protocol exists. No peer-to-peer send/receive is simulated.

No live process memory, TCP connections, unsaved editor buffers, terminal execution, arbitrary extension state or debugger continuation is implemented.
