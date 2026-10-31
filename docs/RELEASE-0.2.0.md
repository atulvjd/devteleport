## DevTeleport 0.2.0 — Apple Silicon development preview

Capture saved development work into an encrypted checkpoint, restore it independently, and verify the result. This is a **prerelease**, intended for development testing.

### Downloads

- **DMG:** recommended installer for Apple Silicon Macs (M1 and newer). Open the DMG and drag DevTeleport to Applications.
- **ZIP:** alternative containing the same application.
- **SHA256SUMS:** checksums for the two downloads. With both files in the same folder, run `shasum -a 256 -c SHA256SUMS`.

**macOS distribution status:** the app has a verified ad-hoc code/resource signature, but is **not Apple Developer ID signed or notarized**. macOS can show a security warning or block a downloaded installation. Local signature integrity and runtime tests do not establish acceptance under every Mac's Gatekeeper policy. Do not disable system-wide security protections. See [Apple's guidance](https://support.apple.com/en-us/102445).

### Included

- Native ARM64 Electron desktop with bundled backend, dark/light themes and guided capture/restore reviews.
- Encrypted streaming format 2 and compatible format 1 reading/restoration.
- Supported standalone Git state, including staged, unstaged and untracked saved files.
- Explicit PostgreSQL and stopped plain local named-volume adapters, with external restore mappings and approvals.
- Direct local-network TLS transfer with pairing, checksum verification and interrupted-upload resume.
- Archive-backed verification, private recovery journals and approved inactive-stage cleanup.

The standalone CLI is separately available with Node.js 24+ on macOS/Linux:

```sh
npm install -g devteleport@0.2.0
devteleport help
```

No repository clone or separately installed Node is required by the desktop. Git, PostgreSQL, Docker and project package managers are required only for the operations using them.

### Validation and boundaries

The recorded native Apple M4 / 16 GiB candidate passed **46 core/security/diff/parser tests** and **19 local verification stages**, including real database/volume workflows, actual Electron/VS Code hosts, actual-DMG signature integrity and 32 dark/light/window-size layout combinations. Before upload, source-to-bundle consistency, bundle integrity and DMG checksums were checked again. These are local observations, not a hosted-CI, security-audit or physical two-Mac certification.

Dependencies and credentials must be provisioned separately. Database/volume capture is opt-in and configured; restore uses a new destination and does not overwrite existing projects. Format 2 and volume adapters have documented limits. No universal secret detector, running-process migration or distributed rollback is claimed. Automatic executable updates remain disabled.

Remaining gates: Developer ID signing/notarization, documented physical-device/fresh-install acceptance, broader fault testing and secure automatic update installation. Windows and physical Intel desktop acceptance are not certified by this release.

The release tag snapshots the source corresponding to the tested runtime/UI. Later handoff/documentation and standalone CLI-package preparation are included where relevant; they do not imply that every bundled document was regenerated after those later edits. No unrelated main-branch history is replaced.
