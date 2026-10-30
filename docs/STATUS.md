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
| Verification                        | Strict check and 30 core/security tests passed with zero skips; actual source Electron workflow passed. All 17 consolidated packaged/service/native checks passed with zero failures/skips; see `dist/evidence/apple-silicon-verification.json` |
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
