# Downloaded application reported as damaged

A user reported that a shared DMG mounts, but DevTeleport is reported as damaged when launching on another Mac. The previous local DMG passed `hdiutil verify`, while strict app-signature verification failed with `code has no resources but signature indicates they must be present`. The executable still had an Electron linker/ad-hoc signature without a valid packaged resource seal. That was a packaging defect distinct from missing Developer ID/notarization.

Local launch tests had not established downloaded-app acceptance. The local DMG also lacked a quarantine attribute; downloads can follow different macOS security checks. No friend-device result is inferred from this diagnosis.

## Correction

Development packaging now explicitly requests electron-builder's ad-hoc identity (`-`) and the project's JIT entitlement for the main application and helpers after packaging changes. This uses no Apple credentials and performs no upload. The file remains labelled `unsigned` to indicate that it is not Apple Developer ID signed/notarized. Ad-hoc signing seals the actual code/resources; it does not identify a trusted developer.

Signed release mode continues to use its separate authorized Developer ID/notarization path. Neither ad-hoc validity nor local runtime tests can satisfy production trust gates.

## New checks

- Architecture verification now also requires `codesign --verify --deep --strict` to pass on the complete packaged bundle. A malformed bundle signature can no longer pass that stage.
- `npm run verify:distribution` verifies the DMG checksum, mounts that actual DMG read-only, verifies the contained application's complete code/resource seal, checks its bundle identifier, detaches it, and records the image SHA-256 in `dist/evidence/distribution.json`.
- The native gate and prepared macOS CI include the actual-DMG check. The consolidated native gate consequently has 18 stages rather than 17.
- `npm run verify:signing` separately records signature integrity, Developer ID identity, Gatekeeper and stapled notarization status. A valid ad-hoc signature must still leave the Developer ID/notarization release gate blocked.

## Sharing and acceptance

Resend the rebuilt DMG and its updated checksum; previous copies do not acquire the correction. Confirm that the recipient has an Apple Silicon Mac and compare SHA-256 values to exclude transfer damage. A matching hash plus successful DMG mount does not establish Apple trust.

Normal distribution under default Gatekeeper policy requires Developer ID signing and notarization. For a knowingly accepted development build, Apple's per-app Open Anyway flow may be available; availability depends on the actual alert and device policy. Do not disable Gatekeeper globally or remove quarantine as a substitute for release validation. Confirm the exact outcome on the recipient's Mac.

Apple references:

- https://support.apple.com/en-us/102445
- https://support.apple.com/en-sg/guide/mac-help/mh40619/mac
- https://support.apple.com/en-ie/guide/security/sec3ad8e6e53/web

Rebuild/native/signing results are recorded below. Signing credentials and physical recipient acceptance remain unavailable in this session.


## Observed repaired candidate

Rebuilt and completed native verification at `2026-10-31T00:12:01.836Z`: **18 PASS**, including the newly mounted actual-DMG integrity stage, with **46 core/security/diff/parser tests**. Packaged Electron workflow, helpers, CLI and trusted/untrusted editor hosts passed. All regenerated artifact checksums verified. `verify:signing` now records codesign **PASS**, but Developer ID, Gatekeeper and notarization remain **BLOCKED**; exit 2 is expected.

Replacement DMG SHA-256: `d73c07b211f396d82e44685b54ab2b7cb7f6c728d1c5493bb334bec3102af1aa`. Previous shared image hash was `f7dfd467dc266152e924226febc4b1fcfa52e10d9d82ddd078f4daddcaa6119a`; that image predates this repair. The latest DMG retains its filename, so resend the rebuilt file, not a cached previous upload. Recipient-device launch and security-prompt acceptance are still unverified. No security protection was disabled, no Apple credentials were used and no notarization upload occurred.
