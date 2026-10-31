# Desktop UI refresh — 2026-10-31

The desktop now uses a consistent graphite/mint dark theme and a matching light theme, with native system typography, a compact sidebar, vector icons, a quieter workspace selector and a visual capture/encrypt/restore overview. Dashboard history and storage remain backed by real local data.

## Interaction improvements

- Capture components distinguish included files/Git from optional PostgreSQL/volume data. Inspecting a workspace enables only configured optional components and explains unavailable choices.
- Capture/restore review results are presented as readable entry counts, payload size, destination, component choices and warnings. Raw reports remain available under technical details.
- Primary capture/restore actions remain disabled until a matching review succeeds. Changing paths/options invalidates readiness; the backend's authentication, approval and no-overwrite guards remain in effect.
- Restore explains that the destination must be a new folder. Database/volume mapping is shown as an optional disclosure and opens when corresponding actions are selected. The npm-only install adapter is labelled accurately.
- Passphrase show/hide controls are explicit and reversible; passphrases are not persisted. Appearance changes save immediately and are applied to the native window on reopening. A matching startup background avoids the default white window.
- Progress, review success and errors have readable summaries. Diagnostic JSON is collapsed by default. Cancellation appears only while busy. Opening the restored project is enabled only for the current verified restore target.
- Starting an operation immediately locks the controls before asynchronous settings persistence. This fixes a stale Completed/busy-state timing issue found during visual testing.
- Navigation resets the page position. Minimum-width layouts stack forms and wrap toolbar actions without horizontal scrolling. Reduced-motion preferences suppress animation; keyboard focus remains visible.

## Validation

`npm run test:desktop` runs a real Electron capture, authenticated archive verification, source removal, independent restore/verification, cancellation, runtime architecture, metadata signature check, window bounds and theme restoration. It also checks unavailable configuration, immediate busy locking and review invalidation.

`npm run test:desktop:visual` runs the actual UI with disposable generated local files, captures a real archive and reviews restore, then records all eight screens at 1140×820 and 800×600 in dark and light themes. It checks horizontal overflow, headings/navigation, renderer errors, show/hide controls and absence of passphrases in saved settings. Screenshots are in `dist/ui-review/`; structured evidence is `dist/evidence/ui-review.json`.

Source visual checks passed all 32 combinations with zero renderer errors. Screenshots were visually inspected, including dashboard, capture review and minimum-width light restore. This is automated layout plus visual review, not a claim of complete assistive-technology, notification or physical two-Mac acceptance.

The native gate now includes the packaged visual-layout stage (19 stages overall). Final rebuilt package results are recorded below. Code/resource seals must continue to verify; Developer ID/Gatekeeper/notarization gates remain separate.


## Final packaged results

Completed `2026-10-31T01:00:04.382Z` with `FORCE_COLOR=1 npm run verify:apple-silicon`: **19 PASS**, zero required skips/failures. The core/security/diff/parser suite has **46 passing tests**. The packaged visual run checked **32 combinations**, all passing with zero renderer errors. The actual DMG app's ad-hoc code/resource seals verified. All four regenerated artifact checksums verified.

DMG SHA-256: `37266add384ab4deca93cb53f29a0bbba6951ace0876223ed398568a698d4519`. The filename remains `DevTeleport-0.2.0-apple-silicon-unsigned.dmg`; resend this new build to share the redesigned UI. Existing installed copies were not overwritten. Source can be launched with `npm run desktop`. No push, public release, Developer ID signing or notarization upload occurred.

The current screenshots and evidence are in `dist/ui-review/` and `dist/evidence/ui-review.json`. Previous benchmark figures describe their original checkpoints and were not rerun for this UI change.
