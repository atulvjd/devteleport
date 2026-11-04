# DevTeleport 0.2.2 validation

Prepared 4 November 2026. The local native Apple Silicon release candidate includes multi-language dependency collection and in-place desktop setup retry. All required local runtime checks passed; Apple distribution trust and external/manual acceptance remain separate gates. See [release notes](RELEASE-NOTES-0.2.2.md) and [adapter coverage](DEPENDENCY-COLLECTION.md).

## Final installer

- File: `dist/releases/v0.2.2/DevTeleport V0.2.2.dmg`.
- Size: **121,431,326 bytes**.
- SHA-256: `86f8d37c5b1f87b6b2e635c81a74eb6e206dd9118c35b4374592f2879250e184`.
- Product, root/lockfile, bundled engine and VS Code extension version: **0.2.2**. Stable application ID: `dev.devteleport.desktop`.
- The final named DMG is byte-identical to `dist/desktop/DevTeleport-0.2.2-apple-silicon-unsigned.dmg`. It was mounted read-only, its enclosed app passed strict deep code/resource verification and identity checks, and it was unmounted afterward. The checksum verifies this exact final filename.
- CLI tarball, VSIX and canonical DMG/ZIP hashes also passed verification in `dist/SHA256SUMS`; a copy is saved with this release's evidence.
- Earlier 0.2.1 final DMG remains unchanged: SHA-256 `c3c4df44015b42c93cf232dc50809f8cfcf5dc24253e8c1df8127aac6769d999`.

## Final local verification

The native release gate completed at `2026-11-04T17:44:52.622Z`: **21 PASS / 0 FAIL / 0 required SKIPPED**. These are new 0.2.2 results, distinct from the older 0.2.1 gate. Every stage log was inspected. Tests used disposable workspaces, isolated Electron/editor profiles, temporary databases and owned Docker fixtures. Docker Desktop was started for validation because its daemon was initially stopped.

| Area | Result |
| --- | --- |
| Native ARM64 host and strict types/syntax | PASS |
| Core/security/formats/recovery/setup/dependency adapters | **111 tests PASS**, zero failures/skips |
| TLS pairing/approval/interruption/resume/expiry | PASS |
| Signed update metadata over HTTPS | PASS; executable update installation stays disabled |
| Two actual Electron instances transferring/restoring | PASS on localhost; one physical Mac |
| PostgreSQL restore/nonempty-target refusal | PASS |
| PostgreSQL 15-to-16 and older-client refusal | PASS |
| Docker named-volume safety and Compose | PASS |
| Combined Express/Git/database/Compose reconstruction | PASS |
| Standalone CLI package/privacy review and temporary installed CLI | PASS; **28 files**, no runtime npm dependencies |
| Versioned VSIX and actual trusted/untrusted VS Code hosts | PASS |
| Bundle ARM64/backend/UI/signature integrity | **48 checks PASS** |
| Packaged CLI/core/UI against current source | **25 matches PASS**; no internal prompts/reports or development dependencies bundled |
| Exact final named DMG checksum/seal/app identity | **3 checks PASS** |
| Packaged inspect/capture/source-removal/restore/verification | PASS |
| Packaged dependency retry/relaunch/stale approval/cancellation | PASS; **8 retry-panel layouts**, zero renderer errors |
| Packaged multi-language collection/selected setup | PASS; **9 ecosystems / 12 fixture projects**, **4 layouts**, zero renderer errors |
| Real Python-only installation through packaged UI | PASS: local wheel installed/imported in the private environment; unselected projects untouched |
| Existing eight-screen dark/light/minimum/standard layout sweep | **32 combinations PASS**, zero renderer errors |

The gate now requires the new packaged retry and collection stages and exactly 21 passing stages. It preserves existing protections and does not count a required skip as success. Fresh core tests also exercise actual offline npm/pnpm dependency resolution, Python wheel/private-environment installation, co-located Node/Python source-removal restore/selective retry, and Ruby/Bundler local-gem installation.

Release evidence and raw stage logs are under `dist/releases/v0.2.2/evidence/`. Machine-readable summary: `dist/evidence/release-0.2.2.json`. The named DMG and its `SHA256SUMS` are in `dist/releases/v0.2.2/`. These files are Git-ignored and must be supplied or rebuilt on a fresh checkout.

Final artifact review found that the CLI archive had picked up its previous dependency guide while documentation was being updated. The CLI alone was rebuilt and its privacy audit and installed capture/diff/source-removal/restore/verification checks were rerun successfully. The final 28-file CLI is 78,343 bytes, SHA-256 `1e7f0aeeafc40afacc846b10f896be93d2a844bf3f62f34322e4324c1b6884db`. This documentation correction did not change the desktop/DMG or runtime source. Both the original gate evidence and supplemental `cli-doc-refresh-*` logs/final package review are preserved; artifact checksums were regenerated and verified afterward.

## Material limits

Some new managers were unavailable for actual native SDK/network acceptance: Yarn, Bun, uv, Poetry, Maven, Gradle, Go/Cargo, Composer, .NET and Dart/Flutter are not universally certified by their planning/guarded-dispatch tests. The inventory identifies static declarations; managers resolve the complete graph after approval. Default features, profiles, optional/platform-specific packages, native builds and private feeds can require additional work. Required runtimes, SDKs and credentials are configured separately.

Developer ID signing/notarization, downloaded-app Gatekeeper acceptance, physical two-Mac/fresh-install/manual acceptance, hosted CI for this exact source and secure update installation remain outstanding. The app is ad-hoc signed for code/resource integrity only. Installation can execute approved project/build/plugin code with user permissions; no execution sandbox or cross-project rollback is claimed. Automatic executable updates remain disabled.

No new dependency audit or performance benchmark was run for this packaging pass; earlier measurements/audits retain their original dates and scope. No agent push, tag, GitHub/npm publication, notarization upload, installed-app replacement or user-project restore occurred. Local source still needs an appropriate commit/review before a matching public release tag. Preserve newer user commits and unrelated original-prompt changes.
