# Public npm CLI release — 0.2.2 published

**devteleport@0.2.2 is publicly available on npm and tagged latest.** The user explicitly requested the update and completed npm browser login and separate security approval on 4 November 2026 (Asia/Kolkata). The previously saved login had expired; a fresh login authenticated account `atulwn`. npm accepted the publish, processed it briefly, and then exposed the actual 0.2.2 version and latest tag. No duplicate publication was attempted.

```sh
npm install --global devteleport@latest
devteleport help
```

The exact reviewed 28-file CLI tarball was published without rebuilding: `dist/devteleport-0.2.2.tgz`, **78,343 bytes**, SHA-256 `1e7f0aeeafc40afacc846b10f896be93d2a844bf3f62f34322e4324c1b6884db`, integrity `sha512-cV0QJJxVqlLEvsqdcx4edvbJ7qYT7fOe4HREOyMWixpQ/die1etvDsPizGvDeqFd7NlFCS2pzbpkBN4GRQ4h0g==`. Registry integrity matched exactly. The allowlist/metadata/privacy review and publication dry run passed. The root monorepo remains private; only the prepared standalone CLI tarball was uploaded.

A fresh **unversioned public-name** installation into a temporary global prefix and empty independent npm cache selected 0.2.2. It passed help, inspection, Node runtime/development/optional/peer inventory, Python detection, format 2 capture, unchanged diff exit 0, changed diff exit 2, original-source deletion, restore and authenticated original-archive verification. The disposable prefix/cache/fixtures were removed; the user's existing global installation was not replaced. No fixture dependency downloads or language-runtime provisioning were needed for this public-install check.

This publishes the CLI only; the desktop DMG, VSIX, source Git push/tag, hosted CI and Apple signing/notarization remain separate actions. Existing SDK/runtime/manual acceptance limits still apply. The 21-stage/111-test local release gate is documented in [0.2.2 validation](RELEASE-0.2.2.md); the public-install check is additional evidence for the exact registry package.

New evidence (also copied into `dist/releases/v0.2.2/evidence/`): `npm-0.2.2-artifact.json`, `npm-0.2.2-dry-run.json`, `npm-0.2.2-publication.json`, `npm-0.2.2-registry.json` and `npm-public-install-0.2.2.json` under `dist/evidence/`. Never publish this name/version again; future changes require a new version. No tokens, passwords, security codes or recovery codes are included in these records.

## Historical 0.2.0 publication

**devteleport@0.2.0 was published and tagged latest on 31 October 2026.** It remains an older public version; latest is now 0.2.2. The historical record below describes that earlier publication under account `atulwn` with explicit user authorization and npm browser/security-key confirmation.

Package page: https://www.npmjs.com/package/devteleport

```sh
npm install --global devteleport
devteleport help
```

Requires Node.js 24+ on macOS or Linux. No source repository, local tarball or desktop installation is required. Selected Git/PostgreSQL/Docker/package-manager operations still need their corresponding tools. Windows is not supported by this published package.

## Exactly what was released

- Version: `0.2.0`; registry latest tag: `0.2.0`.
- Approved artifact: `dist/devteleport-0.2.0.tgz`, 47,513 bytes, 22 files.
- SHA-256: `5e78786224e56247f27810c72929a0a7e57f46ab47d8be2f3a10c54591b92e3e`.
- SHA-512 integrity: `sha512-wvMQYIEHHZPStZv5kkdScbAV5NsrCavwcv1B58p6++Eb2fnUsjuW+P2GEFa3+OxnsB3EMl7EEYsuKFeQIdyiaw==`.
- Tarball: https://registry.npmjs.org/devteleport/-/devteleport-0.2.0.tgz

The exact reviewed tarball was uploaded without rebuilding between approval and publication. Public registry metadata and integrity match it. The package contains compiled CLI/core JavaScript, a CLI-specific README, MIT license, public metadata and four selected user guides. Internal handoff reports, original prompts, desktop, node_modules, developer tooling, runtime npm dependencies and install lifecycle scripts are excluded. The repository root remains private to prevent accidental monorepo publication.

## Actual validation

Before upload: actual tarball allowlist/metadata/documentation-link review; standalone offline installed CLI inspection/capture/diff/source-removal/restore/authenticated verification; strict source checks; npm publication dry run and dry-run integrity comparison all passed.

After upload: confirmed registry version, cryptographic integrity and latest tag. Installed by the unversioned public name `devteleport` into a fresh temporary global prefix with an empty independent npm cache. The installed executable selected 0.2.0 and passed help, inspection, format 2 capture, unchanged diff (exit 0), changed diff (exit 2), original source removal, independent restore and original-archive verification. This ran on native darwin-arm64, Node v24.21.0. Temporary test data was removed.

Evidence:

- `dist/evidence/cli-publication-review.json`
- `dist/evidence/npm-publish-dry-run.json`
- `dist/evidence/npm-publication-attempt.json`
- `dist/evidence/npm-registry-verification.json`
- `dist/evidence/npm-public-install.json`
- `dist/SHA256SUMS`

Initial publication was rejected with E403 because account 2FA was disabled. After the user configured 2FA, the approved retry prompted for npm browser authorization, which the user completed. npm briefly showed a temporary 0.0.0-stage placeholder during processing; the real 0.2.0 package and latest tag were subsequently verified. No further account setup or publication approval is pending for this release.

## Boundaries and next releases

This publishes the standalone CLI only. It does not publish a desktop download, merge PRs, push Git commits, trigger remote CI, notarize an app or certify all platforms. The existing release-candidate limitations remain documented. The previous 46-test/19-stage native result is its recorded runtime checkpoint; the post-publication install test is additional direct evidence for this exact public tarball.

Published name/version combinations cannot be reused. Future changes require a new version and a fresh reviewed artifact. Do not rerun publish for 0.2.0 or rebuild the released tarball and expect it to match the public release. Preserve the released integrity record. No credentials, tokens, OTPs or recovery codes belong in these documents.
