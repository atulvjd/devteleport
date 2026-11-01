# Include ignored project files and secrets

The desktop Capture view has an optional **Include ignored files & secrets** checkbox. It is off by default and is not saved as a preference. Enable it, review the capture again, then create a new encrypted snapshot. Older snapshots do not contain files that were omitted at capture time.

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
