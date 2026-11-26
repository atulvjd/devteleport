# DevTeleport v0.2.3

DevTeleport v0.2.3 adds workspace readiness, approved project startup, environment-file selection, incremental snapshots and a desktop comparison view. It also includes multi-language dependency collection and in-place installation retry from the 0.2.2 source release.

## Added

- **Restore readiness.** Review detected runtime/package-manager versions, Node/Python requirements, PostgreSQL/Docker tools, destination mappings, missing environment names and available disk space. Blocked checks show a next action.
- **Run project.** Review detected npm/pnpm/Yarn/Bun startup scripts and approve execution. Follow live filtered logs, see local URLs and stop the process with Cancel operation.
- **Select environment files.** Choose individual `.env` files to include in an encrypted snapshot. Preview variable names with values hidden. Names-only hints help identify configuration to supply on the destination.
- **Incremental snapshots.** Format 3 stores changed/new file content and references unchanged content in an exact full format 2 base. Keep both archives and use the same passphrase. Existing format 1/2 archives remain supported.
- **Compare workspace.** Review added, removed and modified files, change reasons, Git details, captured database/volume names and excluded paths inside the desktop app.

## Compatibility and current limits

The desktop download targets Apple Silicon Macs. The application is ad-hoc signed and has not been Developer ID signed or notarized. This is a development prerelease with automatic update installation disabled.

Guided startup currently supports detected Node package scripts. Other supported language ecosystems retain dependency installation and manual startup guidance. Runtimes, SDKs and service credentials require configuration on the destination.

Incremental format 3 requires v0.2.3 and the exact full base archive. Incremental chains are refused. Database and Docker-volume payloads remain full backups. Capture still scans/hashes and stages the workspace, while retained archive and transfer size are reduced.

Environment-name hints and log filtering have practical limits. Review project configuration and approve execution only for trusted code. Physical two-Mac, downloaded-app/manual acceptance and trusted executable updates remain release gates.

Read [the workspace guide](WORKSPACE-READINESS.md) for UI steps and CLI examples. Validation and artifact checksums are recorded in [the release report](RELEASE-0.2.3.md).
