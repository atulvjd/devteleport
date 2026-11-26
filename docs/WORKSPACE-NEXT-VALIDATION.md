# Historical workspace-preview validation — 27 November 2026

This report records the preview checkpoint before release versioning. Read [RELEASE-0.2.3.md](RELEASE-0.2.3.md) for the subsequently rebuilt v0.2.3 artifact and verification.

The five requested features are implemented in the desktop and CLI working tree. The repository is now at `/Users/atulenv/Desktop/Projects/devteleport`. These are unreleased changes. The application and local preview retain product version 0.2.2, so a new release version is required before publication.

## Delivered behavior

- Restore readiness shows detected runtime/package-manager versions, Node/Python requirements, selected database/volume tools and trusted mapping requirements, missing environment names and destination/staging space. Blocked checks include next steps.
- Run project reviews declared npm/pnpm/Yarn/Bun startup scripts, requires explicit approval tied to the current manifest plan, streams filtered logs, displays local URLs and stops the supervised project process on cancellation.
- Capture can select individual `.env` files with names-only previews. Unchecked environment files are omitted after selection. Names-only schema hints identify configuration to supply when values do not travel.
- Incremental format 3 archives retain changed/new file bytes with a checksum-bound reference to an exact full format 2 base. Independent restore works after deleting the original source. Deletions, modes and links follow the new file inventory.
- Compare workspace displays additions, removals, modifications and reasons, unchanged counts, Git details, captured database/volume names and omissions. Capture review also lists included/excluded files.

## Fresh verification

The final consolidated native Apple Silicon run passed **22 of 22 stages**, with no failed or required skipped stage. Its core/security suite passed **116 tests**, zero failures and zero skips.

The gate covered strict checks, core/security/archive tests, TLS/update checks, desktop transfer, the new packaged workspace workflow, PostgreSQL, PostgreSQL 15-to-16 compatibility, Docker volume acceptance, independent restore, CLI packaging/global-install smoke, VSIX packaging, trusted/untrusted VS Code hosts, bundle architecture/signature integrity, mounted-DMG integrity, packaged desktop smoke, dependency retry, dependency collection and dark/light visual layouts.

The additional final packaged startup acceptance launched an actual disposable HTTP server through its reviewed npm script, fetched its displayed local URL, checked output filtering, cancelled it and verified the process had exited. The new desktop test also covered environment selection, incremental capture/restore after source removal, readiness hints, file comparison, compact dark/light layouts and zero renderer errors. Screenshots were inspected.

The exact saved public npm 0.2.2 reader separately restored new full format 1 and format 2 snapshots with selected environment files. The saved published npm artifact still has SHA-256 `1e7f0aeeafc40afacc846b10f896be93d2a844bf3f62f34322e4324c1b6884db`.

## Failures encountered and resolution

An initial packaged feature-test launch timed out before a window appeared. The test now has a bounded window wait and emits startup-state diagnostics. Subsequent packaged feature runs and the final consolidated run passed. The initial launch-delay cause was not established, so fresh-install/manual launch acceptance remains relevant.

Docker was initially stopped. That blocked the PostgreSQL version and volume stages. The installed Docker Desktop engine was started, and both the individual retries and final gate passed. Docker was left running after validation.

The expanded readiness flow initially changed the error returned before an explicit database approval, and its UI changed a warning that an existing desktop test expected. Approval-error precedence and the existing dependency-warning wording were preserved. A new storage test also depended on a label that changed during UI refinement. It now asserts the actual required/available byte relationship and insufficient-space state. Final tests passed without dropping coverage.

## Preview and evidence

Local preview folder: `dist/workspace-next/`.

- `DevTeleport-workspace-preview.dmg`, SHA-256 `90696ed05463daeb97cbce5ca058f1fadffda9be44a0835ad652e2a6210a54e4`.
- `desktop/mac-arm64/DevTeleport.app`, the matching ARM64 application bundle.
- `evidence/apple-silicon-verification.json`, final 22-stage result.
- `evidence/workspace-next.json`, final packaged feature acceptance.
- `evidence/next-*.png`, readiness, startup and comparison screenshots.
- `evidence/final-http-acceptance.log`, HTTP startup/cancellation result.
- `SHA256SUMS`, checksums for the copied preview artifacts.

Existing release installers and the immutable published npm tarball were preserved. Source changes are uncommitted. No push, upload or publication was performed.

## Current limits

Run project currently supports detected Node package startup scripts. Other ecosystems retain dependency installation and manual startup guidance. The environment-name inventory provides configuration hints rather than proof of every runtime requirement or valid credentials. Display filtering is best-effort.

Incremental archives require the exact full base and the same passphrase. Chains are refused. Database and Docker-volume payloads remain full backups. Capture still scans/hashes and stages the workspace, while retained archive/transfer size is reduced. Reconstruction requires temporary disk space. Format 3 requires the updated reader.

The preview is ad-hoc signed and lacks Developer ID signing/notarization. Physical two-Mac acceptance, downloaded-app/manual acceptance, broader SDK live installs and trusted executable updates remain separate release gates. Automatic update installation stays disabled.

Read [Workspace readiness and restore follow-up](WORKSPACE-READINESS.md) for commands and UI usage.
