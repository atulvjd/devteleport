# DevTeleport

**Your development environment. Anywhere. Exactly where you left off.**

Local-first development workspace capture and reconstruction, with encrypted `.dtp` files, offline Git recovery, PostgreSQL backups, explicitly configured Docker volumes, a standalone Electron app and a VS Code extension. No cloud account or paid API is required. DevTeleport reconstructs saved state; it does not migrate running processes, TCP connections, debugger execution or unsaved buffers.

## Install

CLI: install Node 24 LTS and install the local tarball:

```sh
npm install -g /path/to/devteleport-0.1.0.tgz
```

The tarball contains JavaScript compiled from TypeScript, with no runtime npm dependencies. From a source checkout, `node apps/cli/main.ts` is equivalent to `devteleport`. Development checks/builds require `npm ci`.

Desktop: install the appropriate macOS DMG. **The desktop engine uses Electron's bundled Node runtime and does not require an external Node installation.** Git, npm, PostgreSQL clients and Docker remain prerequisites only for operations that use those tools. The app is currently unsigned and not notarized. See [status](docs/STATUS.md) for actual architecture testing.

VS Code: install the generated VSIX. Set `devteleport.cliPath` to the absolute installed `apps/cli/main.js` (or `main.ts` in a source checkout) and `devteleport.nodePath` to Node 24. Workspace capture requires workspace trust. Restoring saved files requires their own execution approvals before package or database operations.

## Capture, transfer, restore

```sh
devteleport inspect /path/to/project
devteleport capture --root /path/to/project --name my-workspace --dry-run
devteleport capture --root /path/to/project --name my-workspace --output /path/to/snapshots
# Copy my-workspace.dtp to the destination computer.
devteleport restore /path/to/my-workspace.dtp --target /path/to/new-project --dry-run
devteleport restore /path/to/my-workspace.dtp --target /path/to/new-project
devteleport verify /path/to/new-project --snapshot /path/to/my-workspace.dtp
```

Passphrases are prompted with hidden input; capture requires at least 12 characters. Noninteractive clients can supply `DEVTELEPORT_PASSWORD` through a protected process environment. Never put credentials in command arguments, source files or shell history. There is no password recovery. Encrypted-file `export`/`import` authenticate before copying and refuse existing destinations. No network receiver is opened.

Capture includes saved source, untracked and uncommitted files, Git objects/index/HEAD, lockfiles, Compose files and supported editor files. Staged versus unstaged changes, detached HEAD and unborn branches are preserved. Git configuration, hooks, reflogs and remote URLs are omitted; configure remotes manually. LFS pointer blobs in locally stored Git objects are checked against captured LFS objects; missing or corrupt objects cause refusal. Partial clones, shallow repositories, alternate object stores, linked worktrees, submodules and nested repositories require standalone captures or preparation first. Safe internal links are supported; dangling/chained links are rejected.

Git ignored files, dependency directories at every depth, known credential files/directories, private-key filenames, `.env*`, snapshot output, recovery staging and verification metadata are excluded. High-confidence embedded private keys and common GitHub/AWS credentials are excluded with an explicit omission record. This is not universal secret detection: historical Git objects, arbitrary strings, database contents and volume backups can contain secrets. Review capture contents and omissions before transfer.

Stop writers before capture. Files are read twice and checked for changes, but capture is not a filesystem transaction. Each PostgreSQL dump has its own transaction-consistent view; source, databases and volumes do not share an atomic point in time.

## Configuration

`devteleport.json` supports validated fields only. Exclusions are literal relative prefixes, not globs. PostgreSQL exclusion patterns use the underlying pg_dump pattern syntax.

```json
{
  "exclude": ["coverage", "dist"],
  "databases": [{
    "name": "app",
    "connectionEnv": "DEV_DATABASE_URL",
    "excludeSchemas": ["analytics"],
    "excludeTables": ["public.private_events"]
  }],
  "volumes": [{"name": "uploads", "volume": "myproject_uploads"}]
}
```

Connection URLs belong in the named environment variables, not configuration files. Unknown fields, duplicate adapter names and malformed arrays are rejected.

## PostgreSQL

Install `psql`, `pg_dump` and `pg_restore`. Configure an explicit localhost development URL such as `postgresql://user:password@127.0.0.1:5432/project_dev` using a protected environment. Names containing `prod` or `production` are rejected. Localhost checks cannot detect a production port forward: verify the target yourself.

```sh
devteleport capture --name project --include-db --output /path/to/snapshots
# Create a NEW EMPTY local development database and a trusted mapping outside the snapshot.
devteleport restore project.dtp --target /path/to/new-project --restore-db --approve-db --db-config /path/to/trusted-target.json
```

The trusted target mapping uses the same database alias with a destination `connectionEnv`. Snapshot-provided connection settings are never used for destination selection. Capture checks server/client major versions; restore refuses an older target server or older restore client. PostgreSQL 15 round trips and 15-to-16 forward restore have been tested. Other major versions need their own validation.

Restoration refuses existing user database objects and uses a single transaction per database without `--clean`, ownership or ACL replay. Dumps are executable SQL: approve restoration only for trusted snapshots. Source/database/volume restoration is not an atomic transaction across components. If a post-action fails, restored files remain and recovery metadata reports the last completed file phase.

## Docker services and named volumes

```sh
devteleport services /path/to/restored-project
# Review the plan and Compose files before granting container execution.
devteleport services /path/to/restored-project --start --approve-execution

devteleport capture --name project --include-volumes --output /path/to/snapshots
devteleport restore project.dtp --target /path/to/restored-project --restore-volumes --approve-volumes --db-config /path/to/trusted-target.json
```

The external destination mapping contains `volumes: [{"name":"uploads","volume":"new_uploads_volume"}]`. **Existing destination volumes are always refused**, even if empty. Only plain Docker local named volumes with no driver options are supported. Stop containers using the source volume before capture; the adapter rejects active mounts. Database volumes should use the PostgreSQL adapter instead of raw filesystem backup.

The adapter uses a public `python:3.13-alpine` helper image, which must be available locally or downloadable. It runs without network access, without host binds or a Docker socket, with a read-only container root. Only the selected volume is mounted. Narrow DAC/CHOWN capabilities permit reading and preserving non-root-owned data; archive filtering removes unsafe privilege bits and rejects traversal, special files and escaping links. Volume ownership is preserved, subject to Python's safe extraction permission normalization. Images, bind mounts, arbitrary drivers, live database filesystem consistency and automatic Compose logical-name remapping are not supported. Configure Compose to use the approved restored volume explicitly.

## Dependency installation

Default restore executes no project code. `--install --approve-execution` allows `npm ci` **including lifecycle scripts** when `package-lock.json` is present. Inspect source first. Other package managers are detected and require a reviewed manual installation. Native packages must be rebuilt for the destination platform.

## Desktop and editor workflows

The desktop app uses the same compiled CLI in an isolated Electron utility process. It provides capture and restore review steps, database/volume/dependency approval options, snapshot history, verification, Compose diagnostics, progress phases, cancellation and saved nonsecret path/tool-directory settings. Passphrases are never persisted in settings. A cancelled or crashed operation may leave a private partial/staging path; inspect recovery before removing anything.

The VS Code sidebar runs real CLI operations, saves dirty files only after approval, records saved tabs in `.vscode/devteleport-session.json`, and offers to reopen saved files through public APIs in a trusted workspace. Paths outside the restored folder are refused. The generated session file is part of the working tree. Actual extension-host tests cover commands, cancellation, dirty-buffer saving, saved-tab reopening and untrusted capture refusal. Unsaved buffers, terminals, debugger state and arbitrary extension state are not migrated.

## Authenticity and recovery

```sh
# Key generation and signing prompt for the signing-key passphrase.
devteleport keygen --target /secure/path/team-signing
devteleport sign project.dtp --key /secure/path/team-signing.private.pem
devteleport check-signature project.dtp --key /trusted/path/team-signing.public.pem
devteleport restore project.dtp --target /path/to/new --verify-key /trusted/path/team-signing.public.pem

# Inspect an interrupted operation without deleting or merging data.
devteleport recover /path/to/snapshots
devteleport recover /path/to/restored-project
```

Signatures are optional detached Ed25519 sidecars (`project.dtp.sig`). Transfer the sidecar with the archive and obtain the trusted public key independently. Generated private keys are passphrase-encrypted and permission-restricted. A snapshot passphrase authenticates archive contents but does not identify its author.

`verify DIR` trusts the local editable inventory. Prefer `verify DIR --snapshot FILE` to compare against the authenticated original archive; edited inventories cannot hide modifications in that mode. Verification permits extra files and tolerates Git index stat-cache refresh only when staged entries still match. Capture publishes final `.dtp` names atomically without overwriting; incomplete writes retain a distinct private partial filename. Restore journals distinguish staging, file restoration and completed operations. Recovery inspection is read-only.

## Commands

| Command | Purpose |
| --- | --- |
| `inspect [DIR]` | Runtime, Git and component support report |
| `capture --name NAME` | `--root`, `--output`, `--dry-run`, `--include-db`, `--include-volumes` |
| `restore FILE --target DIR` | Plan or restore new destination; optional explicitly approved post-actions |
| `verify DIR [--snapshot FILE]` | Check expected files and Git staged state; exit 2 on mismatch |
| `history [DIR]` | List real encrypted snapshot files without unlocking |
| `recover DIR` | Read-only partial/staging/journal inspection |
| `services DIR [--start --approve-execution]` | Compose plan or approved startup |
| `export/import FILE --target FILE` | Authenticate and copy without overwriting |
| `keygen`, `sign`, `check-signature` | Optional Ed25519 signatures |

JSON results go to stdout; diagnostics go to stderr. Unknown commands/options fail. Dry-run restore authenticates the archive but performs no restoration or execution.

## Development and release

```sh
npm ci
npm run check              # strict TypeScript + application syntax checks
npm test                   # 22 core/security tests
npm run test:postgres      # isolated PostgreSQL cluster; source DB removed before restore
npm run test:docker        # real Compose analysis, no daemon needed
npm run test:docker:live   # actual volumes, malicious archive refusal, Compose startup
npm run test:pg-versions   # Docker PostgreSQL 15 -> 16, requires host pg_dump 15
npm run test:e2e           # independent Express restore
npm run test:full          # combined Express/Git/PostgreSQL/Compose configuration
npm run test:vscode        # isolated actual VS Code Insiders profile
DTP_TEST_UNTRUSTED=1 npm run test:vscode
npm run test:desktop       # actual Electron controls, settings and cancellation
npm run package:cli
npm run test:package       # offline installed executable smoke test
npm run package:extension
npm run package:desktop -- --publish never
```

Integration commands fail when prerequisites are unavailable; they do not silently substitute mocks. GUI tests require access to a graphical session. Override `DEVTELEPORT_VSCODE_BINARY` for another VS Code installation. The local version-compatibility fixture is intentionally pinned to a host PostgreSQL 15 dump client.

See [support and remaining external validation](docs/STATUS.md), [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [troubleshooting](docs/TROUBLESHOOTING.md), [contribution/release](docs/CONTRIBUTING.md) and [example walkthrough](docs/WALKTHROUGH.md). The bounded in-memory snapshot format supports up to 128 MiB aggregate decoded payload, 32 MiB per file/dump/compressed volume archive, 50,000 project entries and 256 MiB decompressed manifest JSON. Larger projects need exclusions or a future streaming format. File-based transfer is the shipped transfer mechanism; peer-to-peer networking is deliberately not simulated.
