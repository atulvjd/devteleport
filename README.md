# DevTeleport 0.2.2 — Apple Silicon release candidate

**Your development environment. Anywhere. Exactly where you left off.**

Capture saved development state on one Mac, transfer an encrypted snapshot, and reconstruct an independent workspace on another. Native ARM64 Electron app, CLI and VS Code extension. Local-first; no cloud account, paid API, analytics or telemetry.

**Development release candidate, not production-certified.** Signing/notarization and physical two-Mac acceptance remain release gates. [Current status](docs/STATUS.md) · [Apple Silicon release report](docs/APPLE-SILICON-RELEASE.md).

Version 0.2.2 adds multi-language dependency collection, approved installation and in-place desktop retry with per-project status. It includes the earlier live console, optional ignored-file/secrets capture and generated-folder exclusions. See [0.2.2 release notes](docs/RELEASE-NOTES-0.2.2.md) and [dependency collection](docs/DEPENDENCY-COLLECTION.md). The CLI is public on npm as **devteleport@0.2.2**, tagged latest; desktop and VS Code downloads are separate distributions.

## Install and begin

Use the unsigned ARM64 DMG/ZIP only as a development artifact. Development builds are ad-hoc sealed for code/resource integrity; “unsigned” means they lack Apple Developer ID signing and notarization. See [downloaded-app validation](docs/DISTRIBUTION-VALIDATION.md). Production distribution requires real Developer ID signing, notarization and Gatekeeper verification; no protection should be disabled. The desktop bundles its own native engine runtime. Git/npm/PostgreSQL/Docker are needed only for the operations using them.

The [public CLI package](https://www.npmjs.com/package/devteleport) requires native Node.js 24 or newer:

```sh
npm install --global devteleport
devteleport diagnostics
devteleport inspect /path/to/project
devteleport capture --root /path/to/project --name my-project --output /path/to/snapshots --dry-run
devteleport capture --root /path/to/project --name my-project --output /path/to/snapshots
# Transfer the .dtp using file export/import or approved TLS pairing.
devteleport restore /path/to/my-project.dtp --target /path/to/new-project --dry-run
devteleport restore /path/to/my-project.dtp --target /path/to/new-project
devteleport verify /path/to/new-project --snapshot /path/to/my-project.dtp
```

The CLI npm tarball contains JavaScript and no runtime npm dependencies. From source, `node apps/cli/main.ts` is equivalent. Capture/restore prompt for hidden passphrases; automation can supply `DEVTELEPORT_PASSWORD` through a protected environment. Never put credentials in command arguments or source. No password recovery exists.

Install the VSIX in VS Code. It finds an installed `devteleport` on PATH or accepts absolute CLI/Node paths in **user/machine settings**. Snapshot workspace settings cannot select executable paths. The extension supports workspace trust, saved-file capture/reopen, progress cancellation, history, verification and opening the installed desktop through its registered URL scheme.

## What travels

Saved files; standalone Git objects/index/HEAD; staged/unstaged/deleted/untracked changes; lockfiles/runtime metadata; saved editor files; Compose configuration; explicitly selected PostgreSQL dumps and stopped plain local Docker named volumes. Restore works independently after the original source and source database are removed.

No live process memory, open connections, debugger continuation, unsaved editor buffers, arbitrary extension state or terminal history replay is claimed. Linked worktrees/submodules/nested repositories need separate preparation/captures. Shallow/partial/externally shared/corrupt Git object stores are refused. Locally stored LFS pointer blobs must have complete captured objects.

Git configuration/hooks/remotes/reflogs remain excluded. Dependency directories, known credential paths and high-confidence embedded secrets are excluded **by default**, with explicit review records. Current development source adds **Include ignored files & secrets** in Capture (`--include-ignored` in the CLI): an explicit opt-in to include `.env`, dependency folders, Git-ignored files and otherwise filtered project credentials inside the encrypted snapshot. The review lists included environment filenames without their values and warns about sensitive contents; the restore review warns the recipient too. Additional configured exclusions, reserved DevTeleport/Git metadata, size limits and safe-path/symlink rules still apply. See [ignored-file capture](docs/INCLUDE-IGNORED.md).

Secret detection is conservative and can have false positives; it cannot detect every embedded/historical secret. Opting in bypasses the default secret filter. Databases and selected volumes may contain sensitive data and are encrypted, not automatically scrubbed. Share sensitive snapshots only with trusted recipients; copied native dependencies may need rebuilding on another machine. Create a new snapshot to include files omitted from an older one.

## Streaming snapshots

CLI/desktop capture default to format 2; `--format 1` retains the legacy writer and both readers remain supported. The library capture API retains its prior default unless `{format:2}` is requested.

Format 2 hashes/stages files and PostgreSQL exports in bounded chunks, streams AES-256-GCM encryption, authenticates the entire archive before parsing metadata/extracting, and verifies each body checksum before publication. Limits: **16 GiB per file/database**, **32 GiB aggregate**, 16 MiB metadata, 50,000 entries. The volume adapter retains its separate small-volume limits. Format 1's old limits remain unchanged. See [format 2](docs/FORMAT-2.md).

Private plaintext staging requires additional free disk. Permissions protect temporary data; no physical erasure guarantee is made. Stop source writers: consistency checks are not one transaction across source, databases and volumes. Capture/receive publication requires hard-link-capable storage (APFS/HFS+/compatible POSIX filesystems). For ExFAT or unsupported external drives, capture internally and export the encrypted file; do not bypass atomic no-overwrite checks.

## See what changed

```sh
devteleport diff project.dtp /path/to/project          # snapshot vs folder
devteleport diff old.dtp --snapshot new.dtp            # snapshot vs snapshot
```

Lists files added, removed or modified (content, permissions, link target or type) using the same exclusion rules as capture. Works with format 1 and format 2 snapshots. Git internals are summarized unless `--include-git` is given. Exits 2 when anything differs. A second snapshot with a different passphrase reads `DEVTELEPORT_NEWER_PASSWORD`.

## Configure components

`devteleport.json` uses validated literal relative exclusion prefixes and explicit adapter names:

```json
{
  "exclude": ["dist", "coverage"],
  "databases": [{"name":"app", "connectionEnv":"DEV_DATABASE_URL", "excludeTables":["public.private_events"]}],
  "volumes": [{"name":"uploads", "volume":"project_uploads"}]
}
```

Use `--exclude PREFIX` repeatedly for additional capture exclusions. Unknown configuration fields, duplicate adapters and malformed paths are refused.

### PostgreSQL

Supply an explicitly named localhost development URL through the configured environment variable, using protected credential handling. Connection URLs are not stored in metadata or passed as process arguments. Production-like names/remote hosts are refused; localhost checks cannot detect a production port forward.

```sh
devteleport capture --name project --include-db --output /path/to/snapshots
# Create a NEW EMPTY local development database and a trusted mapping outside the snapshot.
devteleport restore project.dtp --target /path/to/new --restore-db --approve-db --db-config /trusted/target.json
```

The external target mapping uses the same alias with a destination `connectionEnv`. Snapshot-provided connections are not used for destination selection. Capture reports source/tool versions, database size and backup timing. Restore checks versions and refuses nonempty targets. PostgreSQL 15 and 15-to-16 restoration are tested. Compatibility beyond tested versions is not certified. Custom-format dumps are executable SQL: approve only trusted provenance. A database restore uses its own transaction, not a cross-system rollback.

### Docker

```sh
devteleport services /path/to/project
# Review configuration, images, mounts and architecture warnings.
devteleport services /path/to/project --start --approve-execution
devteleport capture --name project --include-volumes --output /path/to/snapshots
devteleport restore project.dtp --target /path/to/new --restore-volumes --approve-volumes --db-config /trusted/target.json
```

The trusted target mapping uses `volumes:[{"name":"uploads","volume":"new_uploads"}]`. Existing volumes are always refused. Only stopped plain local named volumes are supported; bind mounts/external drivers/images are not backed up. Use PostgreSQL dumps for live database data instead of raw volume copying. Configure Compose to reference restored volume names explicitly.

Helpers use a public `python:3.13-alpine` image, native ARM64 when running natively on Apple Silicon, no network/host binds/Docker socket, a read-only root, bounded safe extraction and narrow file-access/ownership capabilities. Archive traversal, unsafe links/special files and expansion limits are checked. Source ownership is retained subject to safe permission normalization. Service startup waits for configured health checks or running state; lack of a health check is not application health certification. Unavailable image architectures are reported as unknown, never fabricated as compatible.

### Dependency execution

Ordinary restoration executes no project code. Review detected projects, then select **Restore and install dependencies**. After explicit approval, supported native package managers install their declared libraries. The adapters cover Node.js, Python, Java, Go, Rust, Ruby, PHP, .NET and Dart/Flutter; unsupported formats and missing tools remain visible blockers. Workspace members share their declared root action where ownership can be established. Node startup scripts and other project guidance appear after setup; applications are not started automatically.

Existing locks select clean, frozen, immutable or locked installation where the manager supports it. Missing locks permit version resolution rather than exact reproduction. Installing may use the network and execute build files, plugins or lifecycle scripts with the user's permissions. System runtimes, SDKs and credentials must already be configured; the app does not provision them. Python uses a private project virtual environment. Missing/incompatible tools and unsupported metadata block automatic execution; files-only recovery remains available. Corepack provisioning is disabled, and snapshot passphrases are removed from installer environments.

After files-only recovery or an installation failure, **Dependency recovery** lets you select projects, review their current commands and approve installation in the existing folder. Earlier successful installs remain visible, and unrelated unselected projects' missing tools do not block the selection. Read [the retry guide](docs/DEPENDENCY-RETRY.md). Some new adapters have planner/dispatcher coverage without native SDK download acceptance; consult the [coverage matrix](docs/DEPENDENCY-COLLECTION.md).

```sh
# Preview authenticated requirements before a new destination is created:
devteleport restore project.dtp --target /path/to/new-project --dry-run --install
# Restore and install the reviewed dependencies, including independent subprojects:
devteleport restore project.dtp --target /path/to/new-project --install --approve-execution
# Inspect or retry setup in an existing restored folder:
devteleport setup /path/to/new-project
devteleport setup /path/to/new-project --install --approve-execution
```

These additions are included in the public npm **0.2.2 CLI** and the local 0.2.2 desktop candidate. Use `npm install --global devteleport@latest` for the CLI, or `npm run desktop` from this checkout for the desktop. See [guided restore](docs/GUIDED-RESTORE.md).

## Pair and transfer over your LAN

On the receiving Mac:

```sh
devteleport receive --target /path/to/received.dtp --pairing-output /private/path/pairing.json \
  --bind 0.0.0.0 --advertise 192.168.1.20 --approve-receive
```

Share the protected descriptor out of band and compare its fingerprint. On the sender:

```sh
devteleport pairing-info --pairing /private/path/pairing.json
devteleport send project.dtp --pairing /private/path/pairing.json --approve-peer
```

TLS 1.3 authenticates the receiving certificate; a random bearer token authorizes uploads. The receiver never obtains the snapshot passphrase and never executes contents. Interrupted uploads can resume with matching size/hash and explicit restart pairing. Default bind is loopback, not LAN. No firewall protection should be disabled. Manual addressing ships; discovery is not implemented. **Network transfer remains experimental until real two-Mac validation.** [Protocol/recovery guide](docs/NETWORK-TRANSFER.md).

## Provenance and recovery

```sh
devteleport keygen --target /secure/path/signing-key
devteleport sign project.dtp --key /secure/path/signing-key.private.pem
devteleport check-signature project.dtp --key /trusted/path/signing-key.public.pem
devteleport restore project.dtp --target /path/to/new --verify-key /trusted/path/signing-key.public.pem

devteleport recover /path/to/snapshots
devteleport recover /path/to/snapshots --cleanup /path/to/.devteleport-v2-ID
# Only after reviewing the preview:
devteleport recover /path/to/snapshots --cleanup /path/to/.devteleport-v2-ID --approve-cleanup
```

Ed25519 signatures bind the encrypted file and use externally trusted public keys; transfer `.sig` sidecars separately. Generated private keys are encrypted and permission-restricted. A passphrase authenticates bytes, not an author identity. `verify DIR` trusts an editable local inventory; prefer `verify DIR --snapshot FILE` for comparison against authenticated source metadata. Extra files are permitted. Git index cache refresh is tolerated only when staged entries match.

Cleanup is limited to owned, inactive, recognized private format 2 stages/partials. It refuses active processes, symlinks and arbitrary project directories. Journals expose interrupted phases. Approved post-action failure can leave restored source and earlier successful components intact. No rollback across filesystem/PostgreSQL/Docker is promised.

## Desktop and privacy

The ARM64 app bundles its engine through native Electron utility processes. It includes onboarding, real recent workspaces/snapshots, inspector, capture/restore reviews, local library labels/export/trash, approved network transfer, settings/tool discovery, light/dark mode, native menus, window restoration, local completion preferences, redacted manual diagnostics export and license/privacy information. No data is automatically uploaded.

Current development source also includes a [live workspace console](docs/LIVE-CONSOLE.md): terminal-style commands, real operation steps and dependency-install output, timestamps, elapsed time, result totals, cancellation/error states, auto-follow, copy and private log export. It filters known credential forms and passphrases, renders output as text, and retains a bounded tail. Review before sharing; filtering cannot identify every kind of private application data. It does not add an interactive shell or bypass execution approvals. Previously published 0.2.0 installers/packages are unchanged.

Unsigned executable auto-updates are disabled. Signed release metadata/version infrastructure is tested, but a trusted production feed, Developer ID, notarized artifacts and application installation/restart recovery still require external validation. No independent security audit is implied.

## Verify and build

### Project website

The landing page in [`apps/website`](apps/website/README.md) matches the desktop UI and includes release downloads, screenshots, use cases and CLI recipes. Run `npm run dev:website` to preview it, or `npm run build:website` to generate `dist/website`. Import this repository into Vercel with its root directory left at `.`; the included `vercel.json` builds only the static website without installing desktop dependencies. See the [website deployment guide](apps/website/README.md).

### Application checks

```sh
npm ci
npm run check
npm test                         # core/security/format/recovery/process tests
npm run test:transfer             # real TLS, interruption/resume and expiry
npm run test:updates              # actual HTTPS signed-release metadata
npm run test:postgres
npm run test:pg-versions          # requires host pg_dump 15 and Docker
npm run test:docker:live
npm run test:full                 # source/database removed, real restored HTTP behavior
npm run test:vscode               # actual native host; isolated profile
npm run test:desktop              # real Electron controls/main/backend architecture
npm run test:desktop:transfer     # two real Electron instances, localhost only
npm run package:cli
npm run test:package
npm run package:extension
npm run package:desktop -- --publish never
npm run verify:apple-silicon
npm run checksums
```

The verification gate never treats a required skip as success. See `dist/evidence/apple-silicon-verification.json` and per-stage logs for the actual last run. `verify:signing` reports external signing/notarization gates separately. `package:desktop:signed` requires authorized credentials and explicitly enables notarization upload; do not use it without authorization. Nothing is pushed/published automatically.

[Release report](docs/APPLE-SILICON-RELEASE.md) · [architecture](docs/ARCHITECTURE.md) · [security](docs/SECURITY.md) · [troubleshooting](docs/TROUBLESHOOTING.md) · [contributing](docs/CONTRIBUTING.md) · [example](docs/WALKTHROUGH.md). Historical MVP documentation is retained at `docs/MVP-README.md` and is not the current support contract.
