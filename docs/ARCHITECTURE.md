# Architecture

The dependency-free TypeScript engine lives in `packages/core`: filesystem/Git/runtime/manifest/capture/restore logic in `index.ts`, isolated Docker adapters in `docker.ts`, LFS object integrity in `lfs.ts`, Ed25519 signatures in `signatures.ts` and explicit public types in `types.ts`. Strict TypeScript checks cover the engine and CLI. Runtime validation remains necessary because snapshots and configuration are untrusted JSON.

The CLI is a strict command parser with machine-readable stdout and redacted stderr. `scripts/package.mjs` strips types and rewrites runtime import extensions into an installable JavaScript package. Native type stripping is not used inside installed node_modules.

The Electron main process accepts a fixed IPC vocabulary, starts a compiled backend through Electron `utilityProcess.fork`, limits output/time, reports real progress and exposes cancellation. The renderer has no Node integration, uses isolated preload APIs and a restrictive content policy, and inserts reports as text. Capture/restore require review after selecting final options. Nonsecret settings are saved in app user data; no passphrases are persisted. `scripts/build-backend.mjs` produces compiled backend resources. Packaged desktop uses ASAR for application UI and an external resources directory for its compiled backend, executed by Electron's own runtime. External Node is not required for the desktop engine.

Electron was selected over Tauri for a shared JavaScript engine and native Node utility processes without an additional Rust runtime boundary. The tradeoff is installer size. Project Node/npm, Git, database utilities and Docker remain tools needed for their selected project operations.

The VS Code extension calls a trusted configured CLI, uses public workspace/document/tab APIs, respects workspace trust, and records only saved relative file paths. A test-only dialog driver is exposed exclusively in ExtensionMode.Test so actual extension-host tests can approve/cancel dialogues while retaining real filesystem, editor APIs and backend processes. Production behavior uses native VS Code dialogs. Workspace-containing saved session files trigger activation and a reviewed reopening offer.

## Format 1

Binary envelope: ASCII `DTP1`, 16 random salt bytes, 12 random nonce bytes, 16-byte GCM tag, encrypted gzip UTF-8 JSON. AES-256-GCM authenticates the payload and fixed format identifier. Scrypt uses fixed N=32768, r=8, p=1 and a 32-byte key. There is no attacker-selected KDF cost.

The manifest records actual platform/runtime/Git state, file type/mode/size/SHA-256/base64, explicit omissions and support status, PostgreSQL custom dumps with source/tool versions and exclusion policy, and optional Docker volume gzip-tar payloads with checksums. Secrets and connection URLs are not deliberately placed in metadata. Database/volume payloads may contain sensitive application data and are encrypted with the entire archive.

Compressed and expanded sizes, per-payload sizes and record counts are bounded. This format is intentionally memory-bound. Unknown format versions are rejected; future migrations require explicit validated readers. Optional signatures are detached Ed25519 JSON sidecars binding the SHA-256 of the entire encrypted envelope with a format-specific signing domain. Trusted public keys come from outside the snapshot.

## Capture and restore safety

Capture double-reads source files and checks Git state. It checks LFS pointer blobs against included objects, omits sensitive patterns with review records, and uses credential-free tool arguments. Final archives are written and fsynced to private partial paths, then published with a no-clobber hard link and partial cleanup. Abrupt termination cannot publish an incomplete final archive.

Restore authenticates and validates before extracting. A private sibling staging directory receives directories, files, then safe links. The destination is exclusively claimed with mkdir, never merged or overwritten. Recovery metadata is moved first; journal phases identify staged/restoring/files-restored/complete states. Handled file-stage failures clean only the newly claimed output. Approved post-action failures preserve restored source. Abrupt termination can leave a private stage/new incomplete destination, reported by read-only recovery inspection.

Verification normally uses the local editable inventory; `--snapshot` uses the authenticated original manifest instead. Extra files are permitted. Git index byte differences are accepted only when canonical staged entries match. Inspection and verification disable fsmonitor/hooks, suppress global Git configuration, and remove Git environment overrides before Git subprocesses. No snapshot-provided commands are executed during ordinary restoration.

PostgreSQL restore uses an external trusted mapping, version preflight, nonempty-object refusal and one transaction per database. Docker restore uses an external mapping and randomly labeled ownership claim for a new named volume. Helper containers have no network/host binds/socket, a read-only root, bounded archive expansion and Python safe extraction. Narrow file-access/ownership capabilities preserve application-owned volume data; privilege bits/special/escaping records are rejected or normalized. Existing volumes are never reused.
