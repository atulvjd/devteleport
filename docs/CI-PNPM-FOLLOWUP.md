# pnpm CI prerequisite correction — 2 November 2026

## Observed run

[GitHub Actions run 41442252293](https://github.com/atulvjd/devteleport/actions/runs/41442252293), source `7dc5178e8923da90842dab1c7a95035d35cca4c7`: integrations and applications succeeded. Ubuntu's core job failed in `npm test`; ARM64 macOS recorded the same failed step before cancellation; Intel macOS was cancelled. Job metadata was read through GitHub's public API. The provided screenshots identify the assertion in `tests/setup.test.ts`: `Install a working native pnpm tool before automatic dependency installation.`

The settings-only/empty pnpm workspace test requires a successful setup plan, including an available pnpm tool. The workflow configured Node/npm but never installed pnpm. The app's missing-tool blocker behaved correctly. Matrix fail-fast then cancelled peer jobs. This does not establish a different product defect on each platform.

## Correction

- Install pinned pnpm **12.11.2** with the official `pnpm/action-setup@v6` before the core tests. `run_install: false` prevents it from installing repository dependencies; `npm ci --ignore-scripts` remains the repository installation step.
- Print Node/npm/pnpm versions in a dedicated prerequisite check.
- Keep all existing assertions and add a regression that forces pnpm discovery to fail. Approved direct setup and restore must be refused before project scripts or restore destinations are created.
- Disable matrix fail-fast so platform failures retain complete independent results. Do not use `continue-on-error` or weaken assertions.
- Run the existing offline mixed-manager acceptance fixture on each core runner, exercising actual pnpm/npm dependency installation, source-removal restore, environment preservation, startup and frozen retry.

References: [official pnpm action inputs](https://github.com/pnpm/action-setup#inputs), [GitHub matrix failure handling](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations#handling-failures). The v6 action metadata was fetched and checked; its action runtime is Node 24.

## Fresh local evidence

- Disposable Linux container with no pnpm and no network: the original focused test reproduced the exact assertion, one failed test.
- Same cached Node 24 Linux image with pinned pnpm provisioned inside a disposable container: **83 tests, 82 PASS, 0 FAIL, 1 expected Apple-Silicon-only SKIP**. The mixed-manager restore/startup/retry fixture also passed.
- Native local Apple Silicon Mac with installed pnpm 12.11.2: **83 PASS, 0 FAIL, 0 SKIP**; strict checks passed.
- Workflow YAML, action inputs and prerequisite ordering were checked. Container source mount was read-only; test source/fixtures and pnpm installation lived in the disposable container. The host pnpm installation and private user projects were not changed.

Evidence is under `dist/evidence/ci-pnpm/`. A fresh hosted run on all three configured runners is still required after these changes are committed and pushed; local Linux ARM64 is not hosted Ubuntu x64 or physical Intel macOS. The user subsequently authorized a scoped push of the tested CI/test/documentation correction. Confirm the subsequent hosted result through GitHub Actions; this local evidence alone does not establish a green hosted matrix.

No application/engine code or archive format changed. The existing `DevTeleport V0.2.1.dmg` remains unchanged, SHA-256 `c3c4df44015b42c93cf232dc50809f8cfcf5dc24253e8c1df8127aac6769d999`. Rebuilding the app is unnecessary for this CI/test-only correction. Its signing/notarization limitations remain unchanged.
