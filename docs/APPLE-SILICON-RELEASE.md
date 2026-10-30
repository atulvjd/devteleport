# Apple Silicon release candidate 0.2.0

This is a native Apple Silicon development release candidate, **not a production-certified release**. The stable bundle identifier remains `dev.devteleport.desktop`. No source push, public package/release publication or notarization upload is authorized/performed by this work.

## Actual changes

- Compatible streaming format 2, 16 GiB individual/32 GiB aggregate project/database payloads, bounded metadata/buffers, incremental checksums and encrypted archive publication; format 1 reader/writer retained.
- Standard TLS 1.3 file transfer with explicit receiver approval, protected descriptor/fingerprint pairing, integrity checks, timeout and interrupted-upload resume. Actual two-window Electron transfer/restore tested on localhost.
- Native tool discovery through PATH, current Node installation, Homebrew's reported prefix, configured directories and common version managers; Docker/VS Code application paths recognized. No hardcoded Intel Homebrew dependency directories remain.
- ARM64 subprocess guards, process-group cancellation, cleanup hooks, durable journals and approved inactive private-stage cleanup. No cross-system rollback claim.
- Real dashboard/history summaries, inspector, guided capture/restore review, snapshot labels/unlock/export/trash, transfer UI, tool/settings pages, onboarding, light/dark themes, native menus/keyboard shortcuts, window restoration, custom icon, license/privacy, diagnostics export and update status. No fabricated snapshots/data.
- VS Code status/cancellation and installed-CLI discovery, desktop-open command, actual native host testing. Executable paths are machine/user-scoped, never read from a snapshot's workspace settings.
- Hardened-runtime/entitlement/notarization preparation, explicit unsigned default builds, checksum generation and signed-release preflight. Signed release metadata checking is tested; executable replacement is disabled while signing/feed infrastructure is unavailable.

## Native evidence and repeatable commands

```sh
npm ci
npm run check
npm test
npm run test:transfer
npm run test:updates
npm run test:desktop:transfer
npm run package:desktop -- --publish never
npm run verify:apple-silicon
npm run benchmark
DEVTELEPORT_BENCH_MIB=1024 npm run benchmark
npm run benchmark:desktop
npm run checksums
npm run verify:signing
```

The verification command checks host/Node, strict types/tests, real integrations, actual installed VSIX host behavior, every packaged Mach-O/helper and backend/UI checksums, and the packaged app's actual main/backend runtime architecture. Required failures/skips block success. It writes PASS/FAIL/SKIPPED/BLOCKED evidence under `dist/evidence`; release signing/physical hardware/remote CI gates are reported separately. It does not install prerequisites silently.

The detected reference host is **Apple M4, 16 GiB, darwin-arm64**. Source Node is a native arm64 Mach-O. `architecture.json` records each packaged executable/framework/helper architecture, not just a DMG name. App runtime tests record main and utility backend architectures. There are no production native npm addons in the application bundle.

## Measured performance

Raw observations and methods are in `dist/evidence/performance.json` and `desktop-performance.json`. On this reference host, the recorded 1 GiB compiled-backend fixture took **2.707 s capture**, **2.176 s restore**, with **191,520 KiB peak capture RSS**. The source was removed before restoration and hashes matched. A 256 MiB desktop capture measured **1.330 s**, a new application process/profile reached onboarding in **607 ms**, and aggregate sampled Electron working set peaked at **559,040 KiB**. Two-frame renderer samples were about 12–33 ms during capture.

These are observed generated-fixture results, not universal throughput claims. Buffers/runtime/metadata remain bounded, but file count and supported volume adapters also consume memory. OS caches were not cleared; other system activity was not controlled. Aggregate working-set sums can double-count shared pages; sampling was 250 ms only during an active capture. CLI/desktop review and archive verification add work beyond the engine benchmark. Do not present these numbers as physical two-device or all-M-series benchmarks.

## Release gates and remaining work

- Developer ID identity/notarization credentials are unavailable. Current DMG/ZIP are explicitly unsigned; Gatekeeper/notarization checks must report BLOCKED, not be bypassed. `package:desktop:signed` requires authorized credentials and enables hardened runtime/notarization. Do not invoke it merely to obtain a green local check.
- Physical two-Mac acceptance, first-install OS notification/network permissions, and signed application update installation need real devices/credentials. Localhost/directories/containers/Rosetta do not establish physical transfer validation.
- Remote workflow execution requires an authorized push/run. An origin is configured, but this agent has not pushed or published. Local verification is evidence only for this machine/environment.
- Update installation is intentionally inactive. Signed metadata version checking and source validation are implemented/tested; an actual trusted feed, Developer ID verification, notarized artifacts and installation/restart recovery must be validated before enabling automatic application replacement.
- Recovery has safe retry/resume boundaries, not complete transactional rollback. Files/PostgreSQL/volumes can succeed independently before a later stage fails. The exhaustive interruption matrix across every external-tool phase is not yet certified; preserve evidence and inspect failed operations.
- Format 2 project/database streams support large payloads; the named-volume adapter retains separate small-volume limits. No arbitrary drivers/bind mounts, live database-volume consistency, automatic provisioning, mDNS discovery, Windows certification, universal secret detection or independent security audit is claimed.

See `FORMAT-2.md`, `NETWORK-TRANSFER.md`, `SECURITY.md` and the current status matrix for exact support boundaries.
