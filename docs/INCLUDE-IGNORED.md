# Include ignored project files and secrets

The desktop Capture view has an optional **Include ignored files & secrets** checkbox. It is off by default and is not saved as a preference. Enable it, review the capture again, then create a new encrypted snapshot. Older snapshots do not contain files that were omitted at capture time.

## Projects exceeding 50,000 entries

Enable **Skip dependencies & build caches** alongside **Include ignored files & secrets**, then review again. This separate checkbox is also off by default and is not persisted. It omits directories named `node_modules`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.cache`, `dist`, `build` and `coverage` at every project level. A regular file with one of those names remains eligible. Other ignored files, including `.env`, remain eligible; manual exclusions still win. Review omitted paths before approving: a folder named `build` or `dist` can contain work you want to keep.

CLI equivalent: add `--include-ignored --exclude-generated`. The optional authenticated `capturePolicy.excludeGenerated` records the selection; both formats, restore warnings and directory diff respect it. Readers without any capture policy remain supported. The exact public 0.2.0 reader was checked against both new formats after source removal. Intermediate development previews that strictly validate the older policy shape may reject this new optional field; use this latest build to open it.

The 50,000-entry cap remains in force. Projects with too many remaining source/Git/custom cache entries need additional exclusions or separate captures. Skipped dependencies must be installed after restore; generated outputs must be rebuilt. No snapshot is created by a failed review.

On 2 November 2026, a read-only review of the user's previously failing workspace passed with these two choices: **711 entries / 31,029,787 file bytes**, with environment files retained and root/nested dependency/build directories omitted. This was a review only, not an actual capture or restore of that project. Local evidence: `dist/generated-folders/project-review.json` (contains local paths; do not publish without review).

Latest preview: `dist/generated-folders/desktop/DevTeleport-generated-folders-preview.dmg`, SHA-256 `a943f50243e69e5718ab9b07695402cecf4a158e9f9a84f98f881e730a63f006`. Fresh 72 tests, source/packaged desktop, 32 layouts, 44 architecture/integrity and 3 DMG checks PASS. Evidence: `dist/evidence/generated-folders.json`. This supersedes the earlier include-ignored preview below; public artifacts and installed apps were not replaced. The current running old app needs to be closed and this new preview opened to use the checkbox.

The corresponding development CLI option is:

```sh
devteleport capture --root /path/to/project --name complete-workspace --output /path/to/snapshots --include-ignored --dry-run
devteleport capture --root /path/to/project --name complete-workspace --output /path/to/snapshots --include-ignored
```

Use `node apps/cli/main.ts` in this checkout until a new public CLI version is released. The old published npm 0.2.0 package does not have this flag.

## What changes when enabled

- Git ignored-file exclusions are bypassed, including project `.gitignore`, nested ignore rules and Git's standard ignore sources.
- Default exclusions for `.env`, `.env.local`, credential/configuration paths and dependency folders such as node_modules are bypassed inside the chosen workspace.
- The embedded-credential filter is bypassed, so a file is not silently omitted for containing a recognized key/token pattern.
- Both archive formats record an optional authenticated inclusion-policy field. Restore warns the recipient; snapshot-vs-directory diff uses the same inclusion policy.
- Capture review shows included environment filenames, counts and warnings without revealing their contents. Changing the checkbox invalidates the earlier review.

This is explicit permission to put sensitive project data into the snapshot. Encryption still requires a passphrase; private staging and authentication remain in force. Share the archive and passphrase only with trusted recipients. The ordinary default exclusion behavior is unchanged.

## Boundaries

Additional user exclusions (`devteleport.json` and `--exclude`) still win. DevTeleport's own metadata/staging/partials and existing `.dtp` archives remain omitted. Unsafe Git configuration/hooks/worktrees remain excluded/refused. Escaping/absolute symlinks and unsupported special files are refused. Data outside the workspace is not followed or imported. Current size and entry limits still apply, so a large node_modules tree may exceed the supported archive limits; no unlimited capture is promised.

Capturing dependencies does not make native binaries portable across Node versions, operating systems or architectures. Files-only restore preserves the captured dependency files. Selecting dependency installation can replace captured node_modules and cause verification differences; the restore preview warns about this. Destination paths are still new and never overwrite an existing project.

## Verification

Evidence is saved under `dist/include-ignored/` and `dist/evidence/include-ignored.json`. Tests cover the safe default, explicit inclusion of ignored files/environment/dependencies/embedded credentials, encrypted payloads and metadata-only previews, extra exclusions, protected metadata, unsafe symlink refusal, policy-aware diff, source-removal restore, CLI parsing and legacy metadata compatibility. A separate check uses the exact originally published 0.2.0 CLI tarball to restore new opt-in snapshots in both formats. The desktop regression exercises checkbox opt-in/review invalidation, restored `.env`/ignored data, and a file-list response over 64 KiB.

The larger desktop response exposed an exit/output race: the main process parsed JSON as soon as the utility process exited, even when output was still draining. The handler now waits for both streams before parsing, while retaining output/cancellation limits.

This is current development source and a separate local preview. Existing public release artifacts and installed applications are not replaced. Preview bundle version remains 0.2.0 and needs a new version before public release. Signing/notarization, physical-device acceptance and full consolidated/hosted verification remain separate gates.

Fresh local results (2 November 2026): **70 tests PASS, zero skips/failures**, including six inclusion-policy cases; strict checks PASS; actual source and packaged desktop opt-in/review/source-removal/restore PASS with a >64 KiB response and 600 Unicode filenames; **32 packaged layout combinations PASS**, zero renderer errors; **43 architecture/resource/signature checks PASS**; **3 actual-DMG checks PASS**. The original published 0.2.0 core restored new opt-in snapshots in both formats, identified by tarball SHA-256 `5e78786224e56247f27810c72929a0a7e57f46ab47d8be2f3a10c54591b92e3e`. Existing same-host two-app TLS transfer and restore also passed. The initial desktop run's truncated backend response was addressed by waiting for stream completion and preserving UTF-8 chunk boundaries. No fresh full consolidated or hosted CI result is claimed.

Final local preview: `dist/include-ignored/desktop/DevTeleport-include-ignored-preview.dmg`, SHA-256 `dc48f1772ad28afb9939e2830f6f8fc5907f3b495e96c9cec9709b9d2609aad1`. ZIP/checksums are under `dist/include-ignored/`. The old published DMG is unchanged. The public CLI tarball was not regenerated or republished; its future package allowlist now includes this guide so the security-guide link remains valid.
