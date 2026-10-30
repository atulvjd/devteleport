# Apple Silicon production audit

Initial evidence: host `uname -m=arm64`; Node `process.arch=arm64`; `file` reports native arm64 Node; `brew --prefix=/opt/homebrew`; existing packaged main executable is arm64. Bundle identifier `dev.devteleport.desktop` is preserved. Packaged production app has no `.node` addons; native development/packaging dependencies are not application dependencies.

Working foundations: strict TypeScript engine/CLI; authenticated format 1; standalone Git, PostgreSQL, Docker volume adapters; sandboxed/context-isolated Electron utility-process backend; actual VS Code/Electron tests; existing npm/VSIX/DMG packaging. Existing tests are retained.

Prioritized findings:

- P0: independently inspect every bundled Mach-O executable/helper and exercise packaged runtime architecture, not just the DMG filename. Existing installer generation alone is insufficient evidence.
- P0: desktop defaults contain hardcoded Intel/Homebrew PostgreSQL 15 paths; replace with actual tool discovery, architecture reporting and explicit configuration.
- P0: cancellation kills the backend but does not guarantee rollback of external tools; recovery claims must remain limited and journals must identify incomplete work.
- P1: format 1 stores base64 plus compressed/encrypted copies in memory. Add compatible bounded-memory format 2; keep the tested format 1 reader/writer.
- P1: single-page desktop lacks dashboard, library, onboarding, native menus/light theme and structured review flow. Retain working controls while adding real data-backed sections.
- P1: network transfer is absent; add established TLS with explicit fingerprint pairing/receiver approval, bounded streams and integrity verification; label same-host tests accurately.
- P1: actual integration tests exist, but current report has stale remote-repository assumptions. No push/publication is authorized.
- P2: no Developer ID identity/notarization evidence, no update infrastructure, default Electron icon, no reproducible performance/architecture gate. Prepare signing/update infrastructure without enabling unsigned automatic installation.

Release gates: physical two-Mac transfer, signing/notarization and remote runner execution cannot be inferred from local tests. Do not call this production-ready until critical gates pass. See the continuation report for milestones and measured evidence.
