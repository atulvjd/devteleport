# DevTeleport 0.2.0 — final local release report

Report date: 2026-10-31. This describes the original candidate checkpoint; subsequent fixes and current 46-test verification are documented in [TEST-REPORT-FOLLOWUP.md](TEST-REPORT-FOLLOWUP.md). **Native Apple Silicon development release candidate; not production certified.** No push, package publication, public release, notarization upload or remote CI run was performed.

## 1. Actual code changes

Added streaming format 2 (`packages/core/stream-v2.ts`), streamed PostgreSQL (`postgres-stream.ts`), native discovery (`platform.ts`), process-group supervision (`processes.ts`), approved private-stage recovery (`recovery.ts`), TLS transfer (`transfer.ts`), signed update metadata validation (`updates.ts`) and bounded/no-clobber filesystem helpers (`atomic.ts`). Incrementally extended the existing engine, CLI, Electron app and VS Code extension. Kept bundle identifier `dev.devteleport.desktop`.

## 2. Apple Silicon verification

Actual host: Apple M4, 16 GiB RAM, macOS, native arm64 Node 24.21.0. The packaged application main process and utility backend both ran as arm64. All 14 bundled Mach-O executables/frameworks/helpers were inspected; backend and ASAR UI hashes and bundle version were verified. No production native npm addons require separate rebuilding. Evidence: `dist/evidence/architecture.json`, `dist/native-runtime.json`.

## 3. Implemented features

Native desktop onboarding, dashboard/inspector, guided capture/restore review, real snapshot library with labels/unlock/export/Trash, light/dark/system themes, native menus/shortcuts, window bounds restoration, privacy/license/settings, opt-in notification support and diagnostics export. TLS 1.3 explicit pairing, receiver/sender approvals, integrity verification, expiry/timeouts and interrupted encrypted-upload resume. Format 2 uses bounded streaming, private staging, incremental hashes and authenticated extraction. Recovery previews and approval guard inactive private-stage cleanup. VS Code includes cancellation/status and desktop launch.

## 4. Retained MVP functionality

Compatible format 1 capture/read/restore, encrypted archive import/export, archive-backed verification, optional detached Ed25519 signatures, standalone Git index/history and staged/unstaged/untracked recovery, local LFS validation, opt-in PostgreSQL and named-volume adapters, approved dependency installation/Compose startup, CLI npm package, extension VSIX and bundled desktop backend. Unsafe Git layouts are refused rather than partially represented.

## 5. Work not completed

Developer ID signing/notarization; physical second-Mac acceptance; fresh-install OS permission/notification acceptance; automatic application update installation/restart recovery; authorized remote CI execution; exhaustive fault injection across every external-tool phase; independent security audit. Signed metadata checking is implemented, while executable replacement remains disabled.

## 6. Security improvements

Complete GCM authentication precedes extraction; lengths, paths, entry counts and body hashes are validated. Bounded reads, private journals/stages, disk preflight and no-clobber publication protect failure boundaries. Native-tool guards reject Intel-only executables on ARM. Cancellation terminates supervised process groups. Transfer uses pinned pairing certificate verification and a protected random bearer descriptor; logs/UI do not display bearer tokens. VS Code executable paths ignore workspace overrides. External SQL/package/container execution remains explicitly approved. See `SECURITY.md`, `FORMAT-2.md`, `NETWORK-TRANSFER.md`.

## 7. Actual test results

`npm run verify:apple-silicon`: **17 PASS, zero FAIL, zero SKIPPED**. Its core/security stage contains **30 passing tests, zero skips**. The source Electron workflow also passed separately with `npm run test:desktop`. Packaged and installed-app smoke tests include window restoration and Ed25519 metadata verification in the actual Electron utility runtime.

| Consolidated stage                | Result |
| --------------------------------- | ------ |
| native-host-and-node              | PASS   |
| strict-types                      | PASS   |
| core-security-format-tests        | PASS   |
| tls-transfer                      | PASS   |
| signed-update-https               | PASS   |
| desktop-tls-workflow              | PASS   |
| postgres                          | PASS   |
| postgres-versions                 | PASS   |
| docker-live                       | PASS   |
| independent-restore               | PASS   |
| cli-package                       | PASS   |
| installed-cli                     | PASS   |
| vsix-package                      | PASS   |
| actual-vscode-host                | PASS   |
| untrusted-vscode-host             | PASS   |
| bundle-architecture-and-integrity | PASS   |
| packaged-desktop                  | PASS   |

Exact component commands run by the gate: `npm run check`, `npm test`, `npm run test:transfer`, `npm run test:updates`, `npm run test:desktop:transfer`, `npm run test:postgres`, `npm run test:pg-versions`, `npm run test:docker:live`, `npm run test:full`, `npm run package:cli`, `npm run test:package`, `npm run package:extension`, `npm run test:vscode` (installed VSIX, trusted and untrusted profiles), `node scripts/architecture.mjs`, and `node scripts/desktop-smoke.mjs` with the packaged binary. Exact arguments/environment and per-stage logs are recorded in the script and `dist/evidence/apple-silicon-verification.json`.

## 8. Measured performance

On the actual M4/16 GiB reference host, the generated 1 GiB compiled-backend fixture captured in **2.707 s** and restored in **2.176 s**. Peak capture RSS: **191,520 KiB**; restore: **176,320 KiB**. Original source was removed and recovered hashes matched. Desktop 256 MiB capture: **1.330 s**; new process/profile onboarding: **607 ms**. Aggregate sampled Electron working-set peak: **559,040 KiB**; two-frame samples approximately **12–33 ms**. OS caches were not cleared, generated data used a repeated random block, other activity was uncontrolled and aggregate process memory may double-count shared pages. These are observations, not universal speed or physical-transfer claims. Raw evidence: `dist/evidence/performance.json`, `desktop-performance.json`.

## 9. Installation artifacts

- ARM64 DMG: `/Users/atulenv/Desktop/hacktober/dist/desktop/DevTeleport-0.2.0-apple-silicon-unsigned.dmg`
- ARM64 ZIP: `/Users/atulenv/Desktop/hacktober/dist/desktop/DevTeleport-0.2.0-apple-silicon-unsigned.zip`
- CLI: `/Users/atulenv/Desktop/hacktober/dist/devteleport-0.2.0.tgz`
- VS Code: `/Users/atulenv/Desktop/hacktober/apps/vscode-extension/devteleport-0.2.0.vsix`
- SHA-256: `/Users/atulenv/Desktop/hacktober/dist/SHA256SUMS`

Installed separately at `/Applications/DevTeleport 0.2 RC.app`; the existing `/Applications/DevTeleport.app` 0.1 installation was preserved. The actual installed candidate passed the same native capture/source-removal/restore/verification/window-restoration smoke with isolated user data (`dist/evidence/applications-install.log`). Local execution does not establish Gatekeeper acceptance for downloaded/quarantined software.

## 10. Signing and notarization

**BLOCKED.** `npm run verify:signing` exited 2: codesign/Gatekeeper validation did not pass and no notarization ticket exists. No usable authorized credentials were supplied. Default packaging explicitly disables identity discovery/notarization; signed-build preparation exists but was not invoked. No Gatekeeper bypass is part of the release process.

## 11. Physical transfer

**BLOCKED by hardware availability.** Real two-Electron TLS transfer and independent restore passed on localhost. Node TLS interrupted-transfer/resume tests passed. Neither is a physical two-Mac test or proof of LAN permission/firewall behavior.

## 12. CI

Local consolidated verification passed. macOS ARM64 application/architecture and cross-platform core/service workflows were updated. Origin is configured, but this work did not push or trigger remote jobs. Remote runner execution is pending authorization; workflow configuration is not a successful CI run.

## 13. Known limitations

Format 2: 16 GiB individual payload, 32 GiB aggregate project/database bodies, 16 MiB metadata and 50,000 entries. Named-volume adapters retain smaller compressed/expanded limits; see format documentation. Standalone Git only; unsupported worktrees/submodules/partial histories are explicitly refused. No arbitrary volume drivers, bind-mount migration, live database-volume consistency, universal secret detector, live-process migration or Windows certification. Abrupt crashes may retain private plaintext staging; cleanup requires review. Files/database/volumes are independent components, not a distributed rollback transaction.

## 14. Reproduction

```sh
npm ci
npm run check
npm test
npm run package:desktop -- --publish never
npm run verify:apple-silicon
DEVTELEPORT_BENCH_MIB=1024 npm run benchmark
npm run benchmark:desktop
npm run checksums
npm run verify:signing # expected BLOCKED for unsigned candidate
```

Use a native ARM64 Mac with documented PostgreSQL/Docker/VS Code prerequisites. No prerequisite is silently provisioned by the gate. After runtime/UI changes, rebuild and regenerate evidence/checksums; do not reuse results for stale binaries.

## 15. Release readiness

The native local candidate is implemented and passed its documented automated runtime checks. **It is not ready for a production-certified public release** until signing/notarization, physical-device/fresh-install acceptance, trusted update-install validation and remote release verification are completed. [CONTINUATION.md](CONTINUATION.md) records the next actions and resource requirements.
