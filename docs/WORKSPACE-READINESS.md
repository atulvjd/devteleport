# Workspace readiness and restore follow-up

This unreleased development update adds readiness review, approved project startup, environment-file selection, incremental archives and a desktop comparison view. Existing full format 1 and format 2 archives remain supported. The published npm 0.2.2 package and earlier installers do not contain these changes.

## Restore readiness

Review restore before creating a destination. The app shows detected runtime/package-manager versions, Node constraints, Python requirements from `requires-python` or `.python-version`, selected PostgreSQL/Docker tools, trusted mapping aliases, destination connection environment names, and available versus required disk space. Every blocked check includes a next action. Storage includes a staging allowance. Additional dependency downloads and builds require project-specific space.

Environment hints come from variable names in source `.env` files and templates. Blank assignments count as missing. Values stay hidden in previews. These hints cannot establish which variables arbitrary application code requires or whether supplied credentials work. Files can be restored while application configuration is pending. Selected database/volume execution and dependency installation still require their existing approvals.

## Choose environment files

In Capture, select **Choose environment files…**, then check the specific files to carry. Values are encrypted with the snapshot. The variable-name preview never contains file bodies. Once a selection is made, unchecked `.env` files are omitted even when Include ignored files is enabled. Changing the selection invalidates capture review. A source-folder change clears the selection. Existing ignored-file and generated-directory controls continue to apply to other files.

```sh
devteleport environment /projects/example
devteleport capture --root /projects/example --name selected-env --output /snapshots --env-file .env --env-file packages/web/.env.local
# Explicitly omit all environment files
devteleport capture --root /projects/example --name without-env --output /snapshots --env-file none
```

The bounded name scan skips symlinks, dependency/build directories and known credential directories. Environment files above 1 MiB need manual variable-name review. Their file content can still be captured explicitly. Names-only hints may remain in the encrypted snapshot when `.env` content is omitted, so the recipient can identify configuration to supply.

## Run a restored project

The desktop Run project card is available for the last verified restored directory, including after relaunch. Review startup commands, select one, and explicitly approve script execution. The app displays filtered stdout/stderr and local URLs. Cancel operation stops the supervised process group. Closing the app also cancels the process. An unsuccessful exit appears as an error with the log available for diagnosis.

Startup currently supports detected `dev`, `develop` and `start` scripts for npm, pnpm, Yarn and Bun projects. Other ecosystems retain their dependency installation support and README-based startup guidance. The action uses the package's declared script. It verifies the current dependency-manifest plan against the reviewed ID before executing. Processes run with the user's permissions, so approve trusted project code. Log filtering covers known process/project environment values and common credential patterns, with bounded display output.

```sh
devteleport run-project /projects/restored --dry-run
# Copy the reviewed ID, directory and script from the output
devteleport run-project /projects/restored --package-directory . --script dev --plan-id REVIEWED_ID --approve-execution
```

The CLI streams project output to stderr and returns a final JSON result when the process exits. Use Ctrl-C to stop it. Runtimes, SDKs and service credentials must be configured on the machine.

## Incremental archives

Choose a full format 2 snapshot as the base in Capture, using the same passphrase. The new format 3 archive contains the final file inventory and payloads for changed/new files. Unchanged file bytes are referenced by path, size and SHA-256 from the authenticated base. Deletions, modes and links come from the new inventory. Selected database and Docker-volume backups are stored in full.

```sh
devteleport capture --format 2 --root /projects/example --name full --output /snapshots
devteleport capture --format 2 --root /projects/example --name next --output /snapshots --base /snapshots/full.dtp
devteleport restore /snapshots/next.dtp --target /projects/restored --base /snapshots/full.dtp --dry-run
devteleport restore /snapshots/next.dtp --target /projects/restored --base /snapshots/full.dtp
devteleport verify /projects/restored --snapshot /snapshots/next.dtp --base /snapshots/full.dtp
```

Keep and transfer both archives. A missing, changed or incorrect base is refused. The encrypted delta records the SHA-256 of the exact base archive. Both archives are authenticated before destination publication and every reused payload is checked. Private reconstruction staging is cleaned on success and failure. The base is always selected explicitly. Incremental chains are currently refused, so each delta uses a full format 2 base.

This implementation reduces retained archive size and encrypted transfer bytes. Capture still scans/hashes files and stages the current workspace. Restore needs additional temporary space to reconstruct the full payload. No capture-speed improvement is claimed.

Format 3 requires this updated reader. Full snapshots retain their existing format markers and policy fields. The exact saved public 0.2.2 reader was tested restoring newly created full format 1 and format 2 snapshots with selected environment files. Advanced review information requires the updated UI.

## Compare workspace

Select **Compare workspace** in the sidebar, choose a snapshot and folder, then enter the passphrase. Select the full base for an incremental snapshot. The screen shows added, removed and modified files, change reasons, unchanged counts, Git internal change counts, captured branch/commit/status, database/volume names and omitted paths. Capture review also displays saved and excluded entries. File lists show up to 300 entries per section, with full counts and CLI JSON available.

```sh
devteleport diff /snapshots/full.dtp /projects/example
devteleport diff /snapshots/next.dtp /projects/restored --base /snapshots/full.dtp
```

CLI diff returns exit code 2 when changes are found. The desktop treats that as a completed comparison. This compares file inventories and shows captured database/volume metadata. It does not compare live database rows or live Docker volume contents.

## Verification

Run `npm run check`, `npm test`, `npm run test:desktop` and `npm run test:desktop:workspace`. The new desktop test uses disposable fixtures and an isolated profile, restores after source removal, runs and cancels an approved project process, checks log filtering and local URL display, and exercises dark/light compact layouts. It can target a packaged app with `DEVTELEPORT_APP_BINARY`. The consolidated Apple Silicon gate includes this packaged check.

Saved current-session evidence lives in `dist/workspace-next/evidence/`. Read STATUS.md for the final result and external prerequisites. The preview retains bundle version 0.2.2 and ad-hoc signing. Assign a new release version and complete release acceptance before public publication.
