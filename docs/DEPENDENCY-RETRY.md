# Retry dependency installation in the desktop

The local **0.2.2 release candidate** supports retrying dependency installation in an already restored project. A failed installation no longer requires another restore or a second destination folder. The final local DMG and fresh 21-stage gate are documented in [0.2.2 validation](RELEASE-0.2.2.md). Public downloads remain unchanged until publication; older 0.2.1 preview evidence below is historical.

## Desktop workflow

1. Restore a snapshot with **Restore and install dependencies** approved.
2. If installation fails or is interrupted, open **Restore workspace** and find **Dependency recovery**. The panel identifies the restored folder and each independent installation location.
3. Fix the reported network, tool or project issue. Failed and unrun locations are selected for retry by default. Earlier successful installations remain visible as history; select one explicitly if you want to reinstall it.
4. Click **Review selected packages**. The app reads the current project and tools, displays the selected install commands and any blockers, and runs no installation during this review.
5. Select the execution approval checkbox, then click **Retry dependency installation**.
6. Follow the live console and package statuses. After successful setup, use the displayed startup commands when the project's services and environment are ready.

The retry runs in the same restored folder. The original source and snapshot are not needed once the files have been restored. Dependency installation can change dependency folders and lockfiles and may execute lifecycle scripts with the user's permissions. It does not start the application or verify application readiness.

The desktop recovery panel covers the **last project with a recorded installation attempt**. It is not a general project picker or a history of all previous installation attempts. The CLI continues to support setup of another trusted existing directory.

## Package status and recovery

The panel distinguishes pending, installing, installed, failed, interrupted, not run and not selected installations. Workspace members share their declared root installation; a workspace root is retried once rather than once per member. Earlier successes skipped by a later partial retry are labeled **Installed previously**. That label records history and does not certify that changed project requirements are currently satisfied.

Failure and cancellation preserve the restored files and earlier successful installations. There is no rollback across package installations. Cancellation uses the existing process-group supervisor to stop installer lifecycle descendants. The app remembers the recovery target and status across relaunches; a persisted running attempt is treated as interrupted after restart, requiring a new review and approval.

## Approval and privacy boundaries

- Every retry requires a fresh review followed by explicit execution approval. The main process binds the review to the canonical target, directory identity, selected installation locations and tool-directory configuration, and consumes it for one execution attempt.
- The setup plan identifier binds the reviewed metadata, native toolchain and canonical project root. Changed inputs or tools require another review before scripts run. Existing per-package input checks and symbolic-link refusal remain in place.
- Selecting different packages or changing tool directories invalidates the desktop approval. Missing or incompatible tools, unsupported managers and other existing preflight blockers remain enforced.
- The main process privately saves only the recovery path, fixed install commands, package statuses and timestamps. It does not persist full dependency plans, script bodies, snapshot passphrases or execution approval. Live console filtering remains best-effort; review logs before sharing them.
- Retry executes dependency setup only. It does not repeat snapshot extraction, database restoration or volume restoration, and setup completion does not claim fresh archive verification.

## CLI support

The existing setup workflow remains available:

```sh
devteleport setup /path/to/restored-project
devteleport setup /path/to/restored-project --install --approve-execution
```

The current source also accepts `--plan-id` to require the reviewed plan and repeated `--install-at` arguments to select independent installation roots. Use `.` for the root package. For example, after reading the current review's `id`:

```sh
devteleport setup /path/to/restored-project --install --approve-execution \
  --plan-id REVIEWED_PLAN_ID --install-at api
```

Use `node apps/cli/main.ts` instead of `devteleport` when testing these changes from this checkout. Previously published CLI packages do not gain source changes automatically. `--dry-run` remains read-only.

## Earlier feature-preview validation — 4 November 2026

Fresh local strict checks and **86 core tests passed, with zero failures or skips**. The existing source desktop smoke also passed. The focused regression passed against both source Electron and the final separately packaged ARM64 app, using a real offline npm failure/retry flow with disposable independent projects. It verified source removal, partial installation status, preserved files, relaunch recovery, refused execution without a reviewed approval, read-only review, stale metadata refusal, tool-directory invalidation, selected retry without reinstalling the earlier success, and cancellation of an installer descendant. The snapshot was removed before retry to prove that retry does not restore another copy.

Each focused run checked eight panel layouts across failure/success, dark/light themes and 800/1140-pixel widths, with zero renderer errors. The final packaged screenshots include the corrected help-text spacing. The separate app is `dist/setup-retry/desktop/mac-arm64/DevTeleport.app`. Its architecture verification passed **46 checks**, including backend/UI source hashes and native code/resource integrity; explicit `codesign --verify --deep --strict` also passed. This is ad-hoc integrity validation, without Developer ID signing or notarization.

Aggregate evidence is `dist/evidence/dependency-retry.json`; source acceptance is preserved in `dist/evidence/desktop-setup-retry-source.json`, final packaged acceptance in `dist/evidence/desktop-setup-retry.json`, and architecture results in `dist/setup-retry/architecture.json`. Screenshots are under `dist/setup-retry/`. Re-run with `npm run test:desktop:setup` after building the backend. CI now contains source and packaged retry checks, but this follow-up has not been pushed or verified in hosted CI.

The older 19-stage/82-test release report describes the existing 0.2.1 artifact. No fresh full release gate or new DMG is claimed here. Existing released installers and installations remain unchanged. Preserve user checkpoint `456b49e`, earlier `d2919bf` and newer work. Consult the latest [status](STATUS.md) for later validation or packaging updates.


## Expanded dependency collection — development source

Current development source expands project detection and approved dependency setup beyond npm/pnpm to Python and other common language ecosystems. Read [Dependency collection and installation](DEPENDENCY-COLLECTION.md) for the adapter matrix, selective setup after a files-only restore, private Python environments, installation keys and validation limits. Earlier manager-support tables and test counts in this document describe their recorded checkpoints.
