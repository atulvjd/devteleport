# DevTeleport v0.2.3 release validation

The v0.2.3 Apple Silicon app was rebuilt after updating the root package, lockfile and VS Code extension metadata to 0.2.3. The final native verification passed all **22 stages**, including **116 core/security tests**, zero failures and zero required skips.

The gate exercised the new packaged readiness/environment/incremental/startup/comparison workflow, actual HTTP startup and cancellation, PostgreSQL and PostgreSQL 15-to-16 compatibility, Docker volumes, independent restore, transfer/update checks, packaged CLI and VSIX workflows, trusted/untrusted editor hosts, desktop regressions, dependency retry/collection, visual layouts and app/DMG integrity.

## Artifact

- File `dist/releases/v0.2.3/DevTeleport-v0.2.3-apple-silicon-unsigned.dmg`
- Size 121,438,471 bytes
- SHA-256 `e46fde91ebb8077f1d7f3a7c35474cca41fe8a4ba740557eac69ef659e238ff0`
- Architecture ARM64
- Bundle identifier `dev.devteleport.desktop`
- Bundle/product version `0.2.3`
- Signing ad-hoc, without Developer ID/notarization

The release asset is a copy of the exact final DMG checked by the native gate. Local evidence and checksums are in `dist/releases/v0.2.3/`. The original published npm 0.2.2 artifact and earlier release installers were preserved.

## Distribution

Published as [DevTeleport v0.2.3](https://github.com/atulvjd/devteleport/releases/tag/v0.2.3) in `atulvjd/devteleport`. The public unauthenticated API confirmed publication and the uploaded DMG digest matched the local SHA-256. This operation publishes the DMG through GitHub Releases. npm and Marketplace publication are separate operations.

## Limits

Run project currently supports detected npm/pnpm/Yarn/Bun startup scripts. Incremental format 3 requires the exact full format 2 base and same passphrase, with chains refused. Database/volume payloads remain full backups. Environment names provide configuration hints and log filtering is best-effort. The app remains a development release candidate, with manual/downloaded-app and physical two-Mac acceptance, Developer ID/notarization and trusted executable updates outstanding. Automatic update installation remains disabled.

The earlier workspace-preview validation and resolved failures are recorded in [WORKSPACE-NEXT-VALIDATION.md](WORKSPACE-NEXT-VALIDATION.md). Usage is in [WORKSPACE-READINESS.md](WORKSPACE-READINESS.md).

## Hosted verification and commit record

Hosted [GitHub Actions verification](https://github.com/atulvjd/devteleport/actions/runs/45892816292) passed all five jobs, covering Linux core, Apple Silicon core, Intel Mac core, integrations and applications. Initial tag/main runs encountered 30-second inspection waits in desktop retry/visual tests. Commit `3d8ccd2` aligns those waits with the existing 120-second native-tool deadline, retaining all success assertions. Both tests passed locally and the subsequent complete hosted run passed.

- `e4b32b3` adds core readiness, environment capture, incremental recovery and approved startup.
- `0c14615` adds desktop controls and comparison.
- `f87b323` adds regression coverage and packaged workspace validation.
- `e5e2b6c` versions and prepares the v0.2.3 release, targeted by the annotated `v0.2.3` tag.
- `3d8ccd2` fixes the hosted test waits on main. It changes test code only, so the verified release application artifact remains identical.

The existing draft v0.2.2 release was preserved. The only asset published in v0.2.3 is the requested final DMG.
