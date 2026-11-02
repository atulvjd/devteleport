# DevTeleport 0.2.1 validation

Prepared 2 November 2026. **Final native Apple Silicon development release candidate built and locally verified; Apple trust/distribution gates remain blocked.** See [release notes](RELEASE-NOTES-0.2.1.md) for behavior changes. This report distinguishes completed runtime checks from checks requiring credentials, other hardware or external execution.

## Final DMG

- File: `dist/releases/v0.2.1/DevTeleport V0.2.1.dmg`.
- Size: 121,383,439 bytes.
- SHA-256: `c3c4df44015b42c93cf232dc50809f8cfcf5dc24253e8c1df8127aac6769d999`.
- Product, bundled engine, extension and package version: **0.2.1**. App ID: `dev.devteleport.desktop`.
- The renamed DMG is byte-identical to `dist/desktop/DevTeleport-0.2.1-apple-silicon-unsigned.dmg`. Its checksum was verified, it was mounted read-only, and the contained app passed strict code/resource verification and identity checks. It was unmounted afterward.
- `dist/releases/v0.2.1/SHA256SUMS` verifies this exact final filename. CLI/VSIX/canonical DMG/ZIP checksums are separately in `dist/SHA256SUMS`.
- No GitHub/npm upload, tag, source push, signing upload, installation replacement or user-project restore was performed by this release preparation. Local source changes still need committing/pushing before creating a corresponding release tag. Public 0.2.0 DMG and npm tarball hashes were checked and remain unchanged.

## Fresh verification

The final rebuilt candidate completed the native gate at `2026-11-02T11:15:02.667Z`: **19 PASS / 0 FAIL / 0 required SKIPPED**. This is a fresh 0.2.1 run, not the historical 0.2.0 evidence. Native host: Apple M4, 16 GiB, macOS ARM64, Node 24.21.0. Test fixtures use disposable paths/databases/volumes and isolated editor/application profiles.

| Check | Fresh result |
| --- | --- |
| Strict types and JavaScript syntax | PASS |
| Core/security/formats/recovery/setup/console/diff | **82 tests PASS**, zero failures/skips |
| TLS pairing, approval, interruption/resume and expiry | PASS |
| Signed update metadata over HTTPS | PASS; executable update installation stays disabled |
| Actual two-app transfer and independent restore | PASS on localhost, one physical Mac |
| PostgreSQL independent restore and nonempty-target refusal | PASS |
| PostgreSQL 15-to-16 restore / older-client refusal | PASS |
| Live Docker volume/ownership/overwrite protections and Compose | PASS |
| Combined source/Git/database/application reconstruction | PASS |
| CLI package privacy review and fresh temporary global install | PASS, 26-file package, zero runtime npm dependencies |
| VSIX packaging and actual trusted/untrusted VS Code hosts | PASS |
| Packaged app version, ARM64, engine/UI hashes, identity and code seal | **46 checks PASS** |
| App privacy/source inventory | PASS: 11 ASAR entries, 21 backend files, 25 matching current source files; no internal docs/prompts or build-tool code |
| Final named DMG checksum, mounted seal and app identity | **3 checks PASS** |
| Packaged desktop capture/restore/install/console/cancellation/window persistence | PASS |
| Renderer context isolation, disabled Node integration, sandbox, no renderer require/process, CSP | PASS |
| Dark/light, eight views, standard/minimum windows | **32 combinations PASS**, zero renderer errors; representative screenshots inspected |
| Supplemental Compose configuration and real Express setup/startup | PASS |
| Mixed pnpm/npm settings-only setup, local tarball dependencies, source removal, environment file and frozen retry | PASS; both startup commands executed in the disposable restored fixture |
| Original published 0.2.0 ↔ current compiled CLI compatibility | **4 cases PASS**: formats 1 and 2, both directions, after source removal and archive-backed verification |

Raw logs/reports are under `dist/releases/v0.2.1/evidence/`. Machine-readable summary: `dist/evidence/release-0.2.1.json`. Build, review and supplemental scripts are preserved in `scripts/`; the complete native gate is `npm run verify:apple-silicon` after desktop packaging.

## Performance observations

The generated 1 GiB fixture (a repeated random 1 MiB block, uncompressed format 2) captured in **2.529 s** and restored in **2.143 s** in the isolated repeat; peak RSS was about **201 MiB capture / 177 MiB restore**. The original source was removed, and restored hashes matched. A first run overlapping other release work measured an anomalous **444.255 s restore**; this was not reproduced in the isolated repeat, and its cause was not established. Both records are preserved. No universal speed guarantee is inferred.

Actual final desktop measurement with a fresh profile: onboarding visible at **541 ms**, 256 MiB capture **1.120 s**, sampled peak summed working set **662,496 KiB**. OS caches/background activity were uncontrolled; summed process working sets can double-count shared pages. These are local observations, not device-family, cold-start or physical-network benchmarks.

## Findings fixed during release preparation

- Root, lockfile and extension version metadata advanced together from 0.2.0 to 0.2.1. CI's fixed 0.2.0 VSIX path was replaced with dynamic selection of the matching version.
- Empty pnpm settings files now receive the same root-only semantics as settings-only files; workspace ownership cannot accidentally fall back to package.json.
- Injected ENOSPC during authentication journal setup reproduced a leaked private stage. Initialization is now inside the cleanup boundary, including chmod and key derivation.
- Injected ENOSPC during plaintext authentication staging reproduced an incorrect password/damaged-archive message. Storage/quota and permission/drive errors now receive controlled, actionable messages. Actual wrong passwords/tampering still fail authentication.
- Five failure regressions exercise journal setup, authenticated payload staging, disk-space preflight, capture publication and partial restore publication. They check original data preservation, owned-stage cleanup and successful retry. These are deterministic injected filesystem failures, not physical power-loss/full-disk experiments.
- Release smoke checks now inspect the actual version, UI/backend version, context isolation, disabled renderer Node access, sandbox and CSP. Development Electron reports its own engine version, so native app.getVersion is asserted against the product version only for packaged applications.
- Artifact inspection found internal handoff documents and original prompts in the previous broad desktop docs glob. Desktop packaging now includes only application files, package metadata, LICENSE and the separately inventoried compiled engine. No local test fixtures, user data or build dependencies should be bundled.
- Both formats reproduced a directory-diff failure when a manually excluded subtree later contained an unsafe link. Diff now applies the snapshot's exclusions before enumeration/hashing, without allowing an omission record to hide paths actually captured by the manifest. Two regressions preserve this boundary while still detecting real source changes.

## Security/dependency audit

The user explicitly approved sending dependency names/versions to npm after automatic review initially rejected that external audit. The completed full audit reports 16 moderate development-tool alerts, one upstream minimatch advisory; no high/critical alerts. All reported nodes are marked development dependencies in the lockfile. A separate production audit reports zero alerts. No forced major downgrade/override was applied. Confirmed build-tool exclusion from delivered archives is part of final artifact review.

## Required acceptance boundaries

Developer ID/notarization, downloaded fresh-install Gatekeeper acceptance, physical two-Mac/disconnect acceptance, real hosted CI for this exact source revision, assistive-technology/manual acceptance, trusted update installation/restart recovery and an independent security audit remain separate gates. No claim of every possible failure scenario or production certification is made. Executable updates remain disabled. Existing installations, private projects, databases, containers and published 0.2.0 artifacts must be preserved.
