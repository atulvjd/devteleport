# Contributing and release procedure

Use Node 24 and npm. Run `npm ci`, `npm run check` and `npm test`. The engine/CLI compile with strict TypeScript. Changes to encryption, extraction, credentials and process execution require adversarial coverage. Keep no-overwrite behavior and explicit execution approvals intact.

Integration targets use real tools. Run PostgreSQL, Compose configuration, live Docker adapters, Express, the combined independent restore, actual VS Code host (trusted and untrusted) and Electron tests. The multi-version PostgreSQL fixture requires host pg_dump 15 and Docker. Missing tools cause failures, not silent skips. The version fixture is a focused 15-to-16 test rather than universal version certification.

`npm run package:cli` builds JavaScript into an npm tgz; `npm run test:package` installs it offline and runs its actual bin. `npm run package:extension` builds a VSIX. Set `DTP_TEST_VSIX=/absolute/path/to/package.vsix` when running `test:vscode` to test the actual packaged extension files. `DEVTELEPORT_VSCODE_BINARY` selects a VS Code executable. Test-only dialog responses are available solely under VS Code ExtensionMode.Test, with real backend/editor APIs retained.

`npm run package:desktop -- --publish never` builds compiled backend resources and unsigned local macOS installers when no identity is supplied. The app bundles its engine runtime through Electron utility processes. Validate actual packaged bundles by setting `DEVTELEPORT_APP_BINARY=/path/to/App.app/Contents/MacOS/DevTeleport` and running `node scripts/desktop-smoke.mjs`. Test arm64 natively and x64 on physical Intel hardware; Rosetta results must be labeled as emulated.

Before an external release, inspect the full support matrix and artifacts, validate a physical cross-device restore with the source offline, verify dependency rebuilds and hash outputs. The repository currently has no configured remote; do not push or publish without explicitly selecting and authorizing a repository. CI is configured but remote execution is not implied by local success.

Signing requires a real Developer ID certificate/private key and notarization requires authorized Apple credentials. Do not substitute ad-hoc signing for Developer ID certification. For an authorized signed build, provide credentials through a protected release environment (not source files), enable hardened runtime and the appropriate Electron entitlements, sign both architectures and helpers, notarize through Apple's tools, staple tickets, and verify with codesign/spctl on physical target machines. Those steps upload release artifacts to Apple and require explicit authorization. The currently generated DMGs are unsigned and unnotarized.

No script publishes automatically. Future optional work includes larger streaming formats, additional Git-layout adapters, broader database/Windows platform support and authenticated peer pairing/resume. These must retain accurate support boundaries and independent end-to-end evidence.


## Published CLI

`devteleport@0.2.0` is public on npm. Users can run `npm install -g devteleport` with Node.js 24+ on macOS/Linux. See [NPM-RELEASE.md](NPM-RELEASE.md) for release integrity and clean registry-install evidence. `package:cli` builds only the curated CLI distribution and runs its package audit; never publish the private monorepo root. Future public changes need a new version and explicit release authorization.
