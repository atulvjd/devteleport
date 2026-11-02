# DevTeleport V0.2.1

Native Apple Silicon development release candidate. The desktop application, bundled engine, CLI package and VS Code extension now identify as 0.2.1. Stable application ID remains `dev.devteleport.desktop`; both snapshot formats remain supported.

## Changes since the public 0.2.0 release

- Guided restore reviews npm/pnpm requirements, installs dependencies only with explicit approval, and shows the project's startup commands. Independent nested packages are handled separately. Settings-only, empty and explicit-empty pnpm workspace files are recognized; unsupported configuration and missing/incompatible tools remain blockers.
- Live workspace console shows commands, real phases, filtered installer output, timestamps, elapsed time and results. Logs have a bounded tail, auto-follow, copy and explicit private export. Filtering is best-effort; review logs before sharing.
- Optional **Include ignored files & secrets** captures .env and other ignored project files with explicit warnings. Optional **Skip dependencies & build caches** keeps eligible environment files while skipping known generated directory names at every level. Both are off by default.
- Larger preview responses preserve complete UTF-8 output and wait for backend stream completion.
- Blocked dependency reviews clearly say Needs attention and preserve files-only recovery. Parser diagnostics omit file bodies.
- Authentication setup failure now cleans its private stage. Storage-full, permission and drive errors during authentication are distinguished from incorrect passwords or archive tampering. No-overwrite protections, explicit execution approvals and inactive-stage recovery remain intact.
- Version checks cover the actual packaged application, UI/backend metadata and bundle identity. CI resolves the matching versioned VSIX automatically.

## Distribution boundaries

The supplied ARM64 DMG is ad-hoc signed for code/resource integrity. It is **not Apple Developer ID signed or notarized**. Local integrity and runtime tests do not establish downloaded-app Gatekeeper acceptance. Intel Macs, Windows and physical two-Mac/fresh-install acceptance are not certified by this local release run. Automatic update installation remains disabled.

The approved npm audit reports zero production dependency alerts and 16 moderate development/build-tool alerts associated with [minimatch's upstream advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249). There is no compatible automatic remediation offered for the installed toolchain; the suggested major builder downgrade was not applied. Build only reviewed source/patterns and track upstream remediation. This is not an independent security audit.

Release validation results, exact final checksum and remaining manual/external gates are recorded in [the 0.2.1 validation report](RELEASE-0.2.1.md). Existing public artifacts are not replaced by local packaging; npm publication and GitHub upload are separate actions.
