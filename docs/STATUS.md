# Implementation status — 2026-10-31

The functional local-first MVP is implemented. The follow-up work removed the external Node dependency from desktop, validated the actual VS Code extension host, added real Docker service/volume operations, enabled strict TypeScript, and hardened authentication, interruption handling, secrets, LFS and PostgreSQL compatibility. Signing/notarization, remote CI execution and a physical two-Mac transfer are not claimed.

## Deliverables

| Deliverable | Status | Evidence / boundary |
| --- | --- | --- |
| CLI | Implemented and tested | Real subprocess lifecycle; standalone JavaScript npm tarball and installed-bin smoke test |
| Capture/restore engine | Implemented and tested within documented limits | Source removed before independent-directory recovery; no overwriting; double-read consistency checks; private staging and journals |
| Versioned format | Implemented and tested | Format 1 authenticated envelope, validated manifest, optional database/volume records, unknown-version rejection |
| Encryption/integrity/authenticity | Implemented and tested | Scrypt/AES-256-GCM, SHA-256 checksums, optional detached Ed25519 signatures, verification against authenticated original archive |
| Git preservation | Implemented and tested for standalone repositories | Staged/unstaged/deleted/untracked files, objects/index/HEAD, unborn/detached HEAD; LFS completeness checks; unsafe layouts rejected explicitly |
| PostgreSQL | Implemented and real integration tested | PostgreSQL 15 round trip, 15-to-16 restore, source removal, exclusion policy, nonempty-target refusal, older-client refusal and version preflight |
| Docker Compose/volumes | Implemented for stated adapters and live tested | Approved Compose startup, stopped plain local named-volume backup/restore, non-root file ownership, existing-volume refusal, malicious symlink archive rejection |
| VS Code extension | Implemented, packaged and actual-host tested | Commands, dirty-buffer saving, saved-tab capture/reopen, cancellation and untrusted capture refusal; public APIs only |
| Desktop | Implemented, packaged and actual UI tested | Bundled Electron utility-process backend, review steps, options/approvals, progress, cancellation, nonsecret saved settings, diagnostics and history |
| Snapshot history | Implemented | Real encrypted-file listing with size/time; no fabricated content or global index |
| Verification/recovery | Implemented and tested | File hashes/types/modes, canonical Git index comparison, original-archive verification, read-only recovery inspection and interruption tests |
| Tests | Implemented and run | 22 core/security tests plus real service/database/GUI/editor integration suites; see observed validation |
| Documentation | Updated | README, architecture, security, CLI/configuration usage, troubleshooting, example and contributor/release instructions |
| Installation/build artifacts | Generated | CLI tgz, installable VSIX, unsigned arm64/x64 DMGs; desktop backend bundled in application resources |
| CI | Configured; remote execution pending | macOS/Linux checks, integrations and artifact generation; no remote repository was configured or pushed |
| Example app | Implemented | Express, Compose/PostgreSQL and adapter configuration example; real application HTTP behavior tested |
| Support matrix | Updated | Current evidence and explicit limitations below |

## Observed validation

- `npm run check`: strict TypeScript checking and application syntax checks passed. No `noImplicitAny` exception or blanket diagnostic suppression was introduced.
- `npm test`: 22 actual core/security tests passed with zero skips. Includes filesystem/Git/CLI lifecycles, archive tampering, password failures, path/schema attacks, no-overwrite protections, permissions under restrictive umask, staged-index semantics, authenticated import/export, embedded credentials, signatures, forged local inventory, LFS completeness, forced SIGKILL during publication, disabled Git fsmonitor execution during inspection, corrupt-object refusal and partial-clone rejection.
- Linux: the core/security suite ran in an isolated official Node 24 Debian container with read-only source, non-root user, no network and temporary writable filesystems. An initial approval-error-order failure was fixed before rerunning successfully. Later final source was also rechecked in that environment; exact counts are recorded by its test output.
- `npm run test:postgres`: real isolated PostgreSQL 15 cluster; source database removed before restore; records recovered; excluded table absent; nonempty destination refused.
- `npm run test:pg-versions`: real PostgreSQL 15 and 16 Docker containers; source 15 container removed before approved restore into 16; HTTP-independent SQL records confirmed; PostgreSQL 15 dump client refused capture from server 16. This fixture explicitly requires host pg_dump 15.
- `npm run test:docker`: actual Compose configuration projection without secret environment values.
- `npm run test:docker:live`: actual stopped named-volume capture, source deletion, independent restoration, ownership preservation, existing-target refusal, approved Compose service startup and malicious escaping-link archive rejection and oversized-member refusal before expansion. Temporary containers/volumes are cleaned by the tests.
- `npm run test:e2e` and `npm run test:full`: independent Express recovery and combined Express/Git/PostgreSQL/Compose configuration recovery; source folder and database removed before restoration; approved npm install; real database-backed HTTP response.
- `npm run test:vscode`: actual installed VS Code Insiders extension host with isolated user/extension profiles, not a mocked VS Code module. Tested inspect/capture/restore/verify/history, save-all approval for dirty files, capture cancellation and saved-file reopening. A separate untrusted-workspace run refused capture. Packaged-VSIX checks load extracted actual VSIX files through the same extension-host runner.
- `npm run test:desktop`: actual Electron controls, bundled backend with intentionally nonexistent external Node path, capture/restore review, source deletion, verification, settings without passwords and cancellation before publication. Packaged arm64 and packaged x64 app bundles also passed; x64 ran through Rosetta on Apple Silicon, not an Intel physical Mac.
- `npm run test:package`: offline npm tarball installation into a temporary prefix and real installed executable invocation passed.
- Packaging generated local CLI tgz, VSIX and macOS DMGs. No code signing, notarization, upload, push, publishing or remote CI run occurred.

## Platform evidence

| Platform | Status |
| --- | --- |
| macOS Apple Silicon | Core, PostgreSQL, Docker, Express, actual editor and desktop workflows validated locally |
| macOS Intel | x64 installer generated; packaged x64 workflow validated under Rosetta; physical Intel testing still needed |
| Linux | Core/security suite executed successfully in a real Linux container; native-host desktop/database combinations not certified |
| Windows | Unsupported secondary platform until separately implemented and tested |

## External release gates

1. **Apple Developer credentials:** no usable Developer ID identity/notarization credentials were available. Installers remain unsigned and unnotarized. Sign and notarize only with explicit authorization and the user's credentials.
2. **Physical devices:** a second physical Mac, ideally Intel, was unavailable. Independent-directory/database tests and Rosetta execution do not replace physical cross-device transfer validation.
3. **Remote repository/CI:** no target repository was configured. The workflow is prepared and local equivalents were run; pushing code and triggering remote jobs require an explicitly selected repository and authorization.

## Deliberate MVP limits and optional future work

These are documented product boundaries, not fake completed features:

- File-based transfer ships; peer-to-peer pairing/resume is optional future work, as allowed by the original specification.
- Format 1 is bounded and memory-based: 128 MiB aggregate decoded project/database/compressed-volume payload, 32 MiB per payload, 50,000 project entries, 256 MiB expanded manifest JSON. Each volume also has expansion limits. Streaming/larger archives require a future compatible format.
- Standalone Git repositories ship. Linked worktrees, submodules, nested repositories, shallow history and external alternates are rejected or require separate preparation. Only locally stored Git/LFS objects can be assessed; inaccessible remote history is not fabricated or downloaded automatically.
- Plain local named Docker volumes ship. Bind mounts, external volume drivers, Docker image transport and arbitrary live database volume consistency do not. Stop writers and configure restored Compose volume names explicitly.
- Cancellation stops the backend but is not a cross-component rollback. Temporary files or a new partial destination can remain after abrupt termination or post-action failure. Journals/recovery inspection expose that state; no preexisting destination is overwritten or automatically deleted.
- No universal secret detector, independent security audit, global snapshot index, live process migration, unsaved-buffer replay, terminal execution replay or arbitrary editor extension-state migration is claimed.
