# DevTeleport 0.2.0 status — 2026-10-31

Native Apple Silicon release candidate implemented; **not production certified**. The complete 15-point delivery report is [FINAL-REPORT.md](FINAL-REPORT.md). Design changes and release boundaries are in [APPLE-SILICON-RELEASE.md](APPLE-SILICON-RELEASE.md).

| Area                                | Current status                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI / encrypted capture and restore | Implemented; compatible format 1 plus streaming format 2, source-removal recovery and archive-backed verification                                                                                                                               |
| Git / PostgreSQL / Docker           | Standalone Git preservation; real PostgreSQL version/restore tests; approved Compose and stopped local named-volume adapters                                                                                                                    |
| Native desktop                      | Bundled ARM64 backend; guided reviews, real library, transfer, diagnostics, themes, onboarding, menus, cancellation and nonsecret settings                                                                                                      |
| VS Code                             | Packaged extension; actual trusted/untrusted host testing, cancellation and machine-scoped executable configuration                                                                                                                             |
| Transfer                            | TLS 1.3 pairing, explicit approvals, integrity checks, expiry and interrupted upload resume; actual localhost two-app workflow                                                                                                                  |
| Recovery                            | Durable private-stage journals, process-group cancellation and approved inactive-stage cleanup; no distributed rollback                                                                                                                         |
| Updates                             | Signed metadata validation implemented; automatic application installation remains disabled                                                                                                                                                     |
| Packaging                           | Native ARM64 DMG/ZIP, CLI tarball and VSIX; unsigned development artifacts                                                                                                                                                                      |
| Verification | Latest rebuilt candidate: 46 core/security/diff/parser tests and all 19 native stages PASS; 32 dark/light layout combinations PASS with zero renderer errors. See UI-REFRESH.md and dist/evidence. |
| Performance                         | Actual Apple M4 / 16 GiB: generated 1 GiB fixture captured in 2.707 s and restored in 2.176 s; peak capture RSS 191,520 KiB. Method/caveats in release report                                                                                   |
| CI                                  | Workflows prepared; origin configured; no agent push, publication or remote run performed                                                                                                                                                       |

## Evidence

Machine-readable local evidence lives in `dist/evidence/`. `apple-silicon-verification.json`, when generated for the final bundle, records individual PASS/FAIL/SKIPPED/BLOCKED results and log paths. Required skipped or failed stages prevent runtime verification success. `architecture.json` inventories packaged Mach-O files and verifies backend/UI hashes. Performance measurements are observations, not universal throughput guarantees.

## Remaining release gates

1. Developer ID signing, notarization and Gatekeeper acceptance require authorized credentials. Current artifacts remain explicitly unsigned.
2. Physical two-Mac transfer and fresh-install OS permission/notification acceptance require real devices and manual acceptance. Localhost tests do not substitute for them.
3. Signed update installation/restart recovery needs a trusted feed and signed/notarized artifacts before enabling executable replacement.
4. Remote CI requires an authorized push/run; local results do not imply remote certification.
5. Exhaustive interruption coverage across every external-tool phase and an independent security audit remain outstanding.

See [continuation instructions](CONTINUATION.md), [format limits](FORMAT-2.md), [network transfer](NETWORK-TRANSFER.md) and [security model](SECURITY.md). Windows, arbitrary volume drivers/bind mounts, universal secret detection and live process migration are outside the certified scope.


## Recovery follow-up — 2026-10-31

Fixed approved cleanup ordering so failure to remove a partial archive preserves the staging journal needed for retry. Added two injected filesystem-failure regressions. Fresh strict checks and all 32 tests passed with zero skips. See [RECOVERY-VALIDATION.md](RECOVERY-VALIDATION.md) for exact scenarios and remaining coverage. Earlier 30-test results above describe the preceding checkpoint. The existing installed `/Applications/DevTeleport 0.2 RC.app` has not been replaced by this follow-up; use newly rebuilt artifacts for the fix.

Fresh rebuilt ARM64 candidate verification completed at 2026-10-30T23:14:27.597Z: all 17 consolidated stages PASS, zero required skips/failures. CLI, VSIX, unsigned DMG/ZIP and `dist/SHA256SUMS` were regenerated. Signing, physical-device acceptance and remote CI remain separate unresolved release gates.

## Desktop capture configuration guidance

When optional PostgreSQL or Docker capture is selected, the renderer now inspects the chosen project's configuration before capture and explains which components are missing. The message offers two explicit choices: uncheck the optional component to capture files/Git, or configure it in the project's devteleport.json. No option is silently changed. Added persistent guidance beside those controls.

Fresh `npm run check` and `npm run test:desktop` passed, including a real Electron regression selecting both unconfigured components, confirming no archive is created, then unchecking them and completing capture/source-removal/restore/verification. This UI follow-up is available through `npm run desktop`; previously generated installers and their full-gate evidence predate this UI change and have not been regenerated in this follow-up.


## Contributor test-report fixes and diff integration

Applied reviewed PR #2 test-harness fixes and PR #1 diff functionality locally, then strengthened startup-output parsing/cleanup and added five parser regressions. The colour-enabled suite now has 46 passing tests, including all existing recovery tests and nine diff tests. Express/full recovery and all three live Docker tests passed with FORCE_COLOR=1; Python 3.13.18 accepted the repaired header-only fixture. Remaining core CI macos-14 label moved to macos-15 and affected CI tests explicitly exercise colour output. Fresh rebuilt native verification passed all 17 stages; artifacts/checksums refreshed. No remote merge, push or hosted CI execution was performed. See [TEST-REPORT-FOLLOWUP.md](TEST-REPORT-FOLLOWUP.md) for exact reviewed heads, changes, commands and evidence. Earlier 30/32-test reports are historical checkpoints.


## Downloaded-app packaging correction

A shared app was reported as damaged although its DMG mounted. Local inspection confirmed an invalid packaged app resource seal. Development packaging now explicitly ad-hoc signs the app and helpers, and bundle verification checks that seal. A new actual-DMG mount/signature check is included in the native gate and CI. Fresh rebuilt verification passed **18 stages** with **46 tests**, and checksums were refreshed. Code/resource integrity now passes; Developer ID, Gatekeeper and notarization remain BLOCKED. This is not proof that the friend’s downloaded installation is accepted. See [DISTRIBUTION-VALIDATION.md](DISTRIBUTION-VALIDATION.md) for diagnosis, artifact hashes and remaining trust gates. The filename still says unsigned because the app is not Developer ID signed/notarized. Existing Applications installations were not replaced.


## Desktop UI refresh — latest candidate

Reworked desktop navigation, typography, vector icons, dark/light themes and responsive layouts. Capture now distinguishes included files/Git from configured optional components; review summaries are readable, final actions require a valid matching review, restore mapping is disclosed when needed, progress/errors are summarized, and technical details stay available. Theme changes persist, window startup matches the theme, passphrase visibility is explicit, and restored-project opening is limited to the verified current target.

Fresh rebuilt verification: **19 stages PASS**, **46 core/security/diff/parser tests PASS**, and **32 packaged UI layout combinations PASS**, with zero renderer errors or required skips. Screenshots were inspected; actual-DMG code/resource seals and regenerated checksums passed. Installers include the new UI; existing Applications installations were preserved. See [UI-REFRESH.md](UI-REFRESH.md) for changes, commands, evidence and remaining manual acceptance limits.

## Public npm CLI preparation

Authenticated npm account `atulwn` and prepared a standalone public CLI candidate with an explicit 22-file allowlist; internal handoff reports and original prompts are excluded. Actual tarball audit, fresh offline installed capture/diff/restore/verification, strict checks and npm publication dry run passed. **No package has been published; final public release confirmation is pending.** See [NPM-RELEASE.md](NPM-RELEASE.md) and [CLI.md](CLI.md). Only CLI packaging/docs changed; prior full native verification remains its historical checkpoint.


Public npm release update: the user explicitly approved publication of the reviewed `devteleport@0.2.0` tarball. A real publish attempt was rejected by npm with E403; account `atulwn` has no 2FA enabled. Nothing was published. User account setup is required; retry the same approved artifact after 2FA is enabled, without requesting publication approval again. See NPM-RELEASE.md and dist/evidence/npm-publication-attempt.json.


## Public npm CLI release — 31 October 2026

**Published and independently verified:** `devteleport@0.2.0` is public at https://www.npmjs.com/package/devteleport with latest tag `0.2.0`. Anyone with Node.js 24+ on macOS/Linux can run `npm install -g devteleport`; no repository or desktop is required. Exact registry SHA-512 matched the approved tarball. A fresh public-registry global install with an empty cache passed help/inspect/capture/diff/source-removal/restore/original-archive verification. See [NPM-RELEASE.md](NPM-RELEASE.md) and `dist/evidence/npm-public-install.json`. Earlier pending/authentication-blocked statements are historical and superseded. No desktop publication, Git push, remote merge or remote CI execution occurred. Future CLI changes need a new package version; do not republish 0.2.0.
