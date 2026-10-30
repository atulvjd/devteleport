# DevTeleport

**Your development environment. Anywhere. Exactly where you left off.**

DevTeleport 0.1 is a local-first workspace reconstruction tool. Its dependency-free CLI captures saved project files, standalone Git repositories and optionally local development PostgreSQL databases into authenticated, encrypted `.dtp` files. It reconstructs files in a new directory without contacting the source computer.

This is an initial implementation, not a claim of production readiness or physical two-machine certification. See [support and remaining work](docs/STATUS.md).

## Install and run

Install Node.js 24 LTS and Git. The CLI uses Node's native TypeScript loader and needs no npm dependencies when run from source. Node 24 is a supported LTS line ([official releases](https://nodejs.org/en/about/previous-releases)).

```sh
node apps/cli/main.ts inspect --root /path/to/project
node apps/cli/main.ts capture --root /path/to/project --name my-workspace --dry-run
node apps/cli/main.ts capture --root /path/to/project --name my-workspace --output /path/to/snapshots
# Copy my-workspace.dtp using your preferred file transfer mechanism.
node apps/cli/main.ts restore /path/to/my-workspace.dtp --target /path/to/new-project --dry-run
node apps/cli/main.ts restore /path/to/my-workspace.dtp --target /path/to/new-project
node apps/cli/main.ts verify /path/to/new-project
```

Passphrases are prompted with hidden input. Noninteractive clients may supply `DEVTELEPORT_PASSWORD` through a protected environment. Do not put passphrases in shell arguments, source files, or shell history. Capture requires at least 12 characters. There is no password recovery.

Build the portable CLI package with `npm run package:cli`, then install the generated `dist/devteleport-0.1.0.tgz` with `npm install -g /path/to/devteleport-0.1.0.tgz`. The tarball contains generated JavaScript so Node does not need to strip types inside `node_modules`. The installed `devteleport` command supports the same arguments.

## What arrives

Saved files, supported permissions, safe internal symlinks, Git objects and index, staged and unstaged changes, untracked files, package manifests and lockfiles, Compose files, and saved `.vscode` settings. Git restore works offline, including detached HEAD and unborn branches. Git configuration, hooks and reflogs are excluded; remotes and per-repository settings must be recreated manually. Historical Git objects may contain old secrets: treat archives as sensitive even when current secret files are excluded.

By default, Git-ignored paths, dependency directories at every depth, known credential files, private-key filenames, `.env*`, `.dtp` snapshots and `.devteleport` metadata are excluded. Every omission is reported. There is no blanket "include secrets" option. Review `--dry-run` before capture. Filename detection does not find every embedded secret.

`devteleport.json` supports literal relative path prefixes, not glob syntax:

```json
{
  "exclude": ["coverage", "dist"],
  "databases": [{"name": "app", "connectionEnv": "DEV_DATABASE_URL"}]
}
```

Capture reads files twice and checks Git state to detect changes. Stop development writers for a consistent capture; this is not a filesystem-level atomic snapshot. Databases are transaction-consistent within each `pg_dump`, not synchronized atomically with source files or other databases.

## PostgreSQL

Install matching `pg_dump`, `pg_restore`, `psql` and a compatible local PostgreSQL server. Supply a `postgresql://user:password@127.0.0.1:5432/project_dev` connection URL via the configured environment variable, using a credential manager or protected session. URLs are never passed as process arguments or stored in the manifest.

```sh
devteleport capture --name project --include-db --output /path/to/snapshots
# Create a NEW, EMPTY local development database yourself.
devteleport restore project.dtp --target /path/to/new-project --restore-db --approve-db --db-config /path/to/trusted-target.json
```

The trusted target configuration lives outside the snapshot and uses the same schema with a destination environment variable. Database names are adapter names, mapped explicitly to the destination connection. Only localhost connections are permitted; names containing `prod` or `production` are rejected. This heuristic cannot identify a production port forward: you must verify your destination. Existing user database objects cause refusal. Restoration uses one transaction per database, without `--clean`, ownership or ACL replay. Database dumps contain SQL and must be trusted before granting database execution approval. Failures after file restoration preserve those files and report the failure; previously restored databases are not rolled back across adapters.

## Dependencies and Docker

Source restore never executes project instructions by default. An explicit `--install --approve-execution` permits `npm ci` **including lifecycle scripts** when `package-lock.json` exists. Review project code first. Other package managers are detected, with manual installation required. Rebuild native dependencies when architecture or OS changes.

`devteleport services /path/to/project` runs Docker Compose configuration analysis and returns image names, service dependencies, ports, volume mount types and a proposed startup command. Review configuration before running that command yourself. Volume contents and images are **not** captured. Use the PostgreSQL adapter for supported database data. No automatic service startup or generic volume backup is implemented.

## Desktop and VS Code

The Electron desktop app uses real CLI subprocesses, a sandboxed renderer, isolated preload APIs and a restrictive content policy. Run `npm ci`, ensure Electron's runtime installation script has run, then `npm run desktop`. Set `DEVTELEPORT_NODE` to an absolute Node 24 executable if needed. The GUI provides workspace inspection, capture review, encrypted capture, history, restore planning, file restoration, verification and Compose diagnostics. Database restore and dependency execution require the CLI's explicit approval flags.

Electron was chosen over Tauri because the same JavaScript process boundary can reuse the CLI without adding a Rust toolchain. The tradeoff is a larger installer and an external Node 24 requirement for native TypeScript execution.

Build the extension with `npm run package:extension` and install the resulting VSIX in VS Code. Configure `devteleport.cliPath` to the absolute installed `apps/cli/main.js` (or `main.ts` in a source checkout), and `devteleport.nodePath` to your Node 24 executable. The sidebar invokes real inspect/capture/restore/verify/history commands. Capture offers to save dirty files, records saved tab paths in `.vscode/devteleport-session.json`, and asks before capture. After opening a trusted restored folder, it offers to reopen saved tabs. This generated session file is part of the working tree and may appear as untracked. Unsaved buffers, terminals, debugger state and arbitrary extension state are unsupported.

## Commands

| Command | Behavior |
| --- | --- |
| `inspect [DIR]` | Git/runtime/component report; `--root DIR` also accepted |
| `capture --name NAME` | Encrypted snapshot; `--root`, `--output`, `--dry-run`, `--include-db` |
| `restore FILE` | New destination only; `--target`, `--dry-run`, optional approved database/dependency operations |
| `verify [DIR]` | Compare restored files, symlinks and permissions against local inventory; exit 2 on mismatch |
| `history [DIR]` | List `.dtp` files, sizes and modification times without unlocking |
| `services [DIR]` | Compose service projection and proposed command; no startup |
| `export FILE --target FILE` | Authenticate, then copy encrypted snapshot without overwriting |
| `import FILE --target FILE` | Same portable-file operation in the opposite direction |

Machine-readable JSON goes to stdout; errors and capture summaries go to stderr. `--dry-run` restore still needs the passphrase to authenticate and validate the entire archive. Unknown options fail rather than being ignored.

## Tests and builds

```sh
npm run check        # requires npm ci for the TypeScript checker
npm test
npm run test:postgres # creates and cleans an isolated temporary local cluster
npm run test:docker   # requires Docker Compose CLI, no daemon required
npm run test:e2e      # downloads Express, restores npm dependencies, starts localhost server
npm run test:desktop  # automated actual Electron controls; GUI access required
npm run test:full     # combined Express/Git/PostgreSQL/Compose configuration workflow
npm run package:cli
npm run test:package # offline installation and executable smoke test
npm run package:extension
npm run package:desktop -- --publish never
```

The core suite uses built-in Node testing with real filesystem, Git and CLI processes. Integration targets are explicit; unavailable tools cause failures, not silent success. PostgreSQL needs shared-memory and local-network permissions. Build dependencies need npm access. CI config covers macOS architectures and Linux, integrations, CLI packages, VSIX and unsigned desktop artifacts. Configuring CI does not mean those remote jobs have run.

Read [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [troubleshooting](docs/TROUBLESHOOTING.md), [status](docs/STATUS.md), [contribution and release](docs/CONTRIBUTING.md), and [example walkthrough](docs/WALKTHROUGH.md).
