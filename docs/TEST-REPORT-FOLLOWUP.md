# Contributor test report follow-up

## Local integration

Reviewed the contributor branches against local main `9c721b9` and applied their changes to the working tree, without creating commits, merging remote PRs or pushing:

- PR #2 (`fix/e2e-port-detection`), fetched head `a464c1a520ac3ccccd8b22e8c284c033174db87c`: terminal colour handling, shared startup parser and Python 3.13 oversized-tar fixture repair.
- PR #1 (`feature/diff-command`), fetched head `291c14b1d501c4586f0816a46b4c497cb2aeafe2`: read-only snapshot/folder and snapshot/snapshot comparison, compatible with both archive versions, with nine regression tests. Existing recovery and UI work is retained.

These fetched heads are review checkpoints; they do not establish the current remote merge state.

## Improvements made during review

The shared startup parser now strips terminal controls, buffers complete stdout lines across chunks, checks numeric ranges, keeps stderr separate, bounds diagnostic buffers, and removes listeners/timers on success or failure. Stderr numbers cannot become a port/PID. Clean early exits fail promptly with diagnostics. Process cancellation tests use this parser and register cleanup even when assertions fail. Express teardown tolerates an already-exited server.

Five actual-child-process regressions cover split coloured output, numeric stderr, clean early exit, invalid port ranges, timeouts/listener cleanup and PIDs above the port limit. Existing tests still verify real process-group cancellation, independent application reconstruction and unsafe-volume rejection.

The oversized-member fixture writes a gzip-compressed tar header directly rather than calling `addfile` without file data. The header declares a member above the expansion limit without allocating that body. It was parsed successfully under Python **3.13.18** in an isolated container; all three real Docker volume tests also passed.

The installed CLI smoke now captures a format 2 archive and exercises diff through the installed executable: exit 0 for an unchanged folder and exit 2 for modified content. Comparison covers source-file metadata/content, not database contents, volume contents or runtime equivalence.

## CI preparation

Changed the core matrix's remaining `macos-14` label to `macos-15`; Intel remains `macos-15-intel`. GitHub announced the macOS 14 retirement schedule: <https://github.blog/changelog/2026-10-01-github-actions-macos-14-runner-image-retirement/>. This justifies migration but is not a diagnosis of a particular cancelled job; those logs must still be checked.

Core, Express and combined restore CI tests now explicitly use `FORCE_COLOR=1`. Local consolidated verification strips ANSI codes before checking for skipped tests, so coloured output cannot hide a skip. No hosted workflow has been triggered by this work.

## Observed validation before packaging

- `npm run check`: PASS.
- `FORCE_COLOR=1 npm test`: **46 PASS, zero failures/skips** (32 existing, nine diff, five startup-parser regressions).
- `FORCE_COLOR=1 npm run test:e2e`: PASS, real Express recovery after source removal.
- `FORCE_COLOR=1 npm run test:full`: PASS, combined Express/Git/PostgreSQL/Compose reconstruction.
- `FORCE_COLOR=1 npm run test:docker:live`: all three PASS, including malicious symlink and oversized-member refusal.
- Python 3.13.18 header-only fixture validation: PASS in a network-isolated Docker container.

Final package/native-gate results are recorded below. Signing, physical two-Mac transfer, trusted automatic update installation and remote CI remain unresolved release gates. Earlier evidence and benchmark values describe their recorded checkpoints; they are not new measurements for this follow-up.


## Final rebuilt candidate verification

Completed at `2026-10-30T23:52:49.805Z` with `FORCE_COLOR=1 npm run verify:apple-silicon`: **17 PASS, zero failures/skips**, including **46 core/security/diff/startup-parser tests**. Installed CLI format 2 capture/diff, actual trusted/untrusted VS Code hosts, all bundle checks and packaged Electron workflow passed. CLI tarball, VSIX, unsigned ARM64 DMG/ZIP and SHA256SUMS were regenerated; all four checksums verified. The existing `/Applications` installation was not replaced. Changes remain local and uncommitted; fetched PRs were not merged remotely.
