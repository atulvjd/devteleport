# Troubleshooting

- **Cannot authenticate:** check the passphrase and transferred file. Wrong passwords and damaged payloads intentionally share an error. There is no bypass or password reset.
- **Destination already exists:** choose a new path. DevTeleport never merges or overwrites directories. Keep the old directory until you have verified the restored copy.
- **Workspace changed:** stop watchers, builds and Git operations, then retry. Put snapshots outside the workspace and exclude constantly changing output.
- **Unsupported Git layout:** capture standalone repositories separately. Unshallow repositories and internalize alternate objects first. Do not delete Git metadata to force capture.
- **Unsafe symlink:** replace it with a safe project-local file link or exclude it explicitly. Chained and dangling symlinks are unsupported.
- **Size limit:** exclude build artifacts or split projects. Do not disable security limits to open an untrusted archive.
- **Missing files:** inspect the capture omission list and your Git ignore rules. Credential and dependency exclusions are intentional. Dependencies must be reinstalled; secrets must be provisioned separately.
- **Database connection failure:** check the environment variable, localhost host, port, role permissions and installed PostgreSQL client versions. pg_dump should be at least the server major version. Use the same or a newer compatible PostgreSQL target; an older target may reject the dump. Actual tool errors fail the operation.
- **Database not empty:** create another empty development database and change the trusted destination mapping. No `--clean` or force overwrite exists.
- **Post-action failed:** source files remain at the reported target. Verify them, correct the issue and run the reviewed dependency/database action manually. Retrying restore requires a different destination.
- **Docker unavailable:** install Docker and the Compose plugin. Configuration analysis can work without a daemon; service startup requires a running daemon. Volumes were not backed up by copying Compose YAML.
- **Desktop cannot start CLI:** rebuild with `npm run package:desktop` and inspect backend diagnostics. The desktop backend uses Electron's bundled runtime; an external Node path is not required. Review the activity panel for the actual backend error.
- **VS Code CLI error:** set both CLI and Node paths in settings. Workspace trust is required for capture and reopening session files. Unsaved data must be saved first.
- **Interrupted capture:** a private `.dtp.partial-*` file may remain after abrupt termination; it is not published as a final archive. Use `recover DIR` to inspect incomplete output and choose a new name or remove only the known partial file. Interrupted restoration may leave a `.devteleport-*` staging folder or partial new destination. Inspect before manually removing it.
- **Verification fails after development:** inventory hashes describe capture-time content. Intentional edits cause differences. Extra files are permitted and aren't a failure. Git index stat-cache refreshes are accepted only when staged entries match; changed staged entries still fail.
