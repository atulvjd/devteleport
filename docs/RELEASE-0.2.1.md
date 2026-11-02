# DevTeleport 0.2.1 validation

Prepared 2 November 2026. This report is being completed with fresh local evidence for the final 0.2.1 build. See [release notes](RELEASE-NOTES-0.2.1.md) for behavior changes. The final artifact and exact evidence will be recorded after packaging and verification.

## Findings fixed during release preparation

- Root, lockfile and extension version metadata advanced together from 0.2.0 to 0.2.1. CI's fixed 0.2.0 VSIX path was replaced with dynamic selection of the matching version.
- Empty pnpm settings files now receive the same root-only semantics as settings-only files; workspace ownership cannot accidentally fall back to package.json.
- Injected ENOSPC during authentication journal setup reproduced a leaked private stage. Initialization is now inside the cleanup boundary, including chmod and key derivation.
- Injected ENOSPC during plaintext authentication staging reproduced an incorrect password/damaged-archive message. Storage/quota and permission/drive errors now receive controlled, actionable messages. Actual wrong passwords/tampering still fail authentication.
- Five failure regressions exercise journal setup, authenticated payload staging, disk-space preflight, capture publication and partial restore publication. They check original data preservation, owned-stage cleanup and successful retry. These are deterministic injected filesystem failures, not physical power-loss/full-disk experiments.
- Release smoke checks now inspect the actual version, UI/backend version, context isolation, disabled renderer Node access, sandbox and CSP. Development Electron reports its own engine version, so native app.getVersion is asserted against the product version only for packaged applications.

## Security/dependency audit

The user explicitly approved sending dependency names/versions to npm after automatic review initially rejected that external audit. The completed full audit reports 16 moderate development-tool alerts, one upstream minimatch advisory; no high/critical alerts. All reported nodes are marked development dependencies in the lockfile. A separate production audit reports zero alerts. No forced major downgrade/override was applied. Confirmed build-tool exclusion from delivered archives is part of final artifact review.

## Required acceptance boundaries

Developer ID/notarization, downloaded fresh-install Gatekeeper acceptance, physical two-Mac/disconnect acceptance, real hosted CI for this exact source revision, assistive-technology/manual acceptance, trusted update installation/restart recovery and an independent security audit remain separate gates. No claim of every possible failure scenario or production certification is made. Executable updates remain disabled. Existing installations, private projects, databases, containers and published 0.2.0 artifacts must be preserved.
