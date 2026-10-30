# Recovery validation follow-up

## Defect fixed

Approved format 2 recovery previously removed the private staging directory first, including the journal linking it to the unpublished partial archive. A subsequent partial-file deletion failure left that partial without the journal needed for a supported retry.

Cleanup now removes recognized sibling partials before removing staging. Missing partials are tolerated during deletion so an independently removed partial does not block cleanup. An error removing a partial leaves staging and its journal intact. Final archives are never cleanup targets.

## New regression evidence

`tests/recovery.test.ts` injects filesystem removal failures into disposable fixtures using the Node test runner:

- Partial deletion fails with EACCES: approved cleanup rejects; journal and partial contents remain; preview still lists both; an approved retry removes them.
- Staging deletion fails before recursive removal begins: the partial is already gone; preview still recognizes staging; an approved retry succeeds; an existing final archive remains unchanged.

Fresh `npm run check` and `npm test` passed: 32 tests, zero failures/skips. These simulations verify error handling and retry ordering; they do not claim a real disk-full or power-loss experiment. Recursive deletion can itself partially remove a directory before failing; preservation of every journal across such a failure is not certified by these tests.

## Remaining failure/acceptance matrix

| Scenario | Evidence / remaining action |
| --- | --- |
| Incorrect password, corrupted/truncated archive, malicious metadata | Existing core/format tests |
| Process-group cancellation | Existing process test |
| Forced capture interruption | Existing security test; not every streaming phase |
| Interrupted TLS upload / resume / expiry | Existing transfer integration tests |
| Partial cleanup failure and retry | New injected filesystem regression |
| Staging removal rejected before recursion | New injected filesystem regression |
| Mid-recursion deletion failure | Not certified; manual inspection may be required |
| ENOSPC during staging, encryption, authenticated payload and restore publication | Add deterministic disposable filesystem tests; verify output/journal state |
| SIGKILL at every streaming publication and post-action boundary | Expand fixture-driven phase coverage |
| Database success followed by volume/install failure | Explicitly document and test preserved per-component state |
| Actual notification/network permission prompts | Manual fresh-install acceptance required |
| Physical two-Mac disconnect/restart/re-pair | Additional hardware required |

No distributed rollback is claimed. Never remove preexisting user projects, databases, volumes or final archives to make a retry succeed.

Fresh rebuilt ARM64 candidate verification completed at 2026-10-30T23:14:27.597Z: all 17 consolidated stages PASS, zero required skips/failures. CLI, VSIX, unsigned DMG/ZIP and `dist/SHA256SUMS` were regenerated. Signing, physical-device acceptance and remote CI remain separate unresolved release gates.
