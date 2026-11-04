# DevTeleport CLI

Capture supported development workspace state into an encrypted snapshot, restore it into a new directory, and verify the result. No repository clone or desktop app is required to use this package.

**Development release candidate.** Best tested on macOS Apple Silicon. Linux core workflows have limited test evidence; Windows is unsupported. This is not a production-certified backup system or a substitute for independent backups.

## Install

Requires Node.js 24 or newer and npm, on macOS or Linux.

```sh
npm install --global devteleport
devteleport help
```

With Node version managers, global installation belongs to the active Node installation. The desktop app and VS Code extension are separate distributions; neither Electron nor their build dependencies is installed by this CLI package.

## Capture, restore, verify

Replace the paths with your actual project, archive and a new destination:

```sh
devteleport inspect /path/to/project
devteleport capture --root /path/to/project --name workspace --output /path/to/snapshots --dry-run
devteleport capture --root /path/to/project --name workspace --output /path/to/snapshots
devteleport restore /path/to/snapshots/workspace.dtp --target /path/to/new-project --dry-run
devteleport restore /path/to/snapshots/workspace.dtp --target /path/to/new-project
devteleport verify /path/to/new-project --snapshot /path/to/snapshots/workspace.dtp
```

The CLI prompts for passphrases in interactive terminals. Use at least 12 characters for capture. There is no password recovery. For noninteractive use, set `DEVTELEPORT_PASSWORD` through your trusted environment or secret manager; do not put passphrases in command arguments. `DEVTELEPORT_PROGRESS=1` emits progress records to stderr. JSON results are written to stdout.

Dependencies and known credential files are excluded by default. Configure credentials separately and install dependencies with the project's package manager. A separate subproject may require its own dependency installation. Default restore does not run package scripts, SQL or containers.

Current development source supports `capture --include-ignored`: explicitly include `.env`, dependency folders, Git-ignored files and otherwise filtered credentials inside the encrypted snapshot. Additional configured exclusions and reserved metadata/size/safe-path protections remain active. Review and restore reports warn about sensitive contents; previews never display file bodies. Only use this for trusted recipients. Previously omitted files require a new snapshot. This flag is not in the previously published npm 0.2.0 package.

Add `--exclude-generated` to skip dependency/build/cache directories at every level while leaving `.env` eligible with `--include-ignored`. Names skipped: `node_modules`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.cache`, `dist`, `build`, `coverage`. Review the omitted paths and reinstall/rebuild after restore. The 50,000-entry limit still applies. This development flag is also absent from the published npm 0.2.0 package.

## Commands

| Command                                        | Purpose and options                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `help` / `--help`                              | Basic usage; this README covers commands omitted by the compact help output                                                                            |
| `inspect [DIR]`                                | Inspect local state; alternatively `--root DIR`                                                                                                        |
| `diagnostics`                                  | Discover native tools and architecture                                                                                                                 |
| `capture`                                      | `--root DIR --name NAME --output DIR`; optional `--dry-run`, `--format 1                                                                               | 2`, repeated `--exclude PREFIX`, `--include-db`, `--include-volumes` |
| `snapshot-info FILE`                           | Authenticate and display metadata without payload contents                                                                                             |
| `restore FILE`                                 | `--target NEW_DIR`; optional `--dry-run`, `--verify-key PUBLIC.pem`, and explicit component approvals below                                            |
| `setup [DIR]` | Development source: preview package requirements, install commands and startup scripts; `--install --approve-execution` installs or retries dependencies. `--dry-run` prevents installation. |
| `verify [DIR]`                                 | Check local inventory; use `--snapshot FILE` for authenticated original metadata                                                                       |
| `diff FILE [DIR]`                              | Compare source-file state with a directory; optional `--include-git`                                                                                   |
| `diff FILE --snapshot NEWER`                   | Compare two snapshots; `DEVTELEPORT_NEWER_PASSWORD` can supply a different newer passphrase                                                            |
| `history [DIR]`                                | List local encrypted snapshots                                                                                                                         |
| `recover [DIR]`                                | Inspect interrupted-operation evidence                                                                                                                 |
| `recover --cleanup PRIVATE_STAGE`              | Preview recognized inactive staging cleanup; add `--approve-cleanup` to delete eligible artifacts                                                      |
| `services [DIR]`                               | Inspect Compose configuration; startup requires `--start --approve-execution`                                                                          |
| `export FILE --target COPY`                    | Authenticate and copy an encrypted archive without overwrite                                                                                           |
| `import FILE --target COPY`                    | Authenticate and copy an incoming archive without overwrite                                                                                            |
| `receive`                                      | `--target NEW.dtp --pairing-output NEW.json --approve-receive`; optional `--bind ADDRESS --advertise ADDRESS --port NUMBER --timeout SECONDS --resume` |
| `pairing-info --pairing FILE`                  | Inspect public receiver identity/fingerprint without displaying the bearer token                                                                       |
| `send FILE --pairing PAIR.json --approve-peer` | Authenticate and send a snapshot to the approved receiver                                                                                              |
| `keygen --target PREFIX`                       | Generate encrypted Ed25519 signing keys                                                                                                                |
| `sign FILE --key PRIVATE.pem`                  | Write a detached signature using an encrypted private key                                                                                              |
| `check-signature FILE --key PUBLIC.pem`        | Verify against an independently trusted public key                                                                                                     |

Exit 0 means command success. Exit 1 indicates an error. `diff` returns 2 for differences; `verify` returns 2 for verification mismatches. Snapshot signatures establish authorship only relative to the externally trusted public key.

## Optional components and execution

Capture PostgreSQL or plain stopped local named volumes only through explicit project configuration in `devteleport.json` and the corresponding include flag. Git, PostgreSQL client tools, Docker/Compose and package managers are external prerequisites for operations that use them; they are not bundled or installed automatically.

Example database configuration uses an environment-variable name, not a connection password:

```json
{
  "exclude": ["coverage", "dist"],
  "databases": [{ "name": "app", "connectionEnv": "DEV_DATABASE_URL" }]
}
```

Database restore requires `--restore-db --approve-db --db-config TRUSTED.json`, with an explicit mapping to an empty local development database. Volume restore requires `--restore-volumes --approve-volumes --db-config TRUSTED.json` and new destination volume names. Never reuse production targets.

Version 0.2.2 expands `restore --install --approve-execution` to reviewed Node.js, Python, Java, Go, Rust, Ruby, PHP, .NET and Dart/Flutter projects through supported native package managers. The dry-run report includes identified library declarations and install commands before creating the destination. Node declarations include runtime, development, optional and peer libraries. Managers resolve direct and transitive dependencies from the project's metadata. Existing locks select clean/frozen/immutable/locked behavior where supported; absent locks permit resolution. Declared workspace members share their root action where ownership is known.

Installation uses the network and may execute build files, plugins or lifecycle scripts; only approve trusted projects. Missing/incompatible tools, unsupported formats and conflicting locks remain blockers. Python uses an owned private virtual environment; activate `.devteleport/python-env/bin/activate` in that project before using its installed libraries. System runtimes, SDKs, services and private-feed credentials are configured separately. Swift/Elixir, Pipenv/legacy Python and ambiguous workspace formats require manual setup. Several adapters have planning/guard coverage without native SDK download acceptance. Snapshot passphrases are not passed to installers; filtered live output is not a universal secret detector. Failure preserves restored source and earlier completed installs, without rollback across managers.

After restoring, use the project's README and displayed Node startup commands. `setup DIR --install --approve-execution` can retry setup without restoring again. To run selected reviewed locations, pass the review's `id` as `--plan-id ID` and repeat `--install-at KEY`. Node keys remain directories (`.` or `api`); other adapters use the exact `installKey` returned by the plan, such as `python3:.` or `cargo:worker`. Unselected projects' missing tools do not block selected supported locations. These additions are not in the previously published npm 0.2.0 package; use the new local package or source CLI until publication.

## Transfer and recovery boundaries

Transfer is direct TLS 1.3 with manual pairing, not a hosted relay. Default receiver bind is `127.0.0.1` (same-machine only). On a LAN, choose a reachable receiver address, share its protected descriptor through a trusted channel, and compare fingerprints before approval. Restart/resume requires a new descriptor. Receiving never decrypts or executes the snapshot; restore is separate.

Existing destinations are never overwritten. Files, databases and volumes are separate components, not one rollback transaction. Abrupt crashes can leave private plaintext staging and journals; inspect before approving cleanup.

## Format and support limits

Format 2 is the CLI default; format 1 remains readable and writable. Format 2 limits are 16 GiB per file/database payload, 32 GiB aggregate bytes, 16 MiB metadata and 50,000 entries. Named-volume adapters retain 32 MiB compressed/128 MiB expanded limits. Unsupported Git layouts are refused; only locally complete standalone Git/LFS state is supported. No running process memory, unsaved buffers, arbitrary volume drivers or universal secret detection is promised.

Read the [format](FORMAT-2.md), [network protocol](NETWORK-TRANSFER.md), [security model](SECURITY.md) and [troubleshooting](TROUBLESHOOTING.md) before relying on a restored workspace.

MIT licensed. Source and issues: https://github.com/atulvjd/devteleport
