# Live workspace console — development preview

The desktop shows terminal-style operation activity inside the existing interface. It is a live output viewer, not an interactive shell or an additional execution approval.

## What the user sees

- The actual backend command arguments, without passphrases.
- A step strip for capture/restore and an operation label for other actions.
- Relative timestamps, elapsed time, current phase, completed steps and failed/cancelled states.
- Real stdout/stderr from approved dependency installations, filtered before reaching the renderer.
- File/payload/component/install totals, verification differences and relevant result messages.
- Auto-follow with a manual off switch, copy, private text export and clear controls.

Capture, restore, inspection, verification, history, diagnostics, recovery inspection and transfer use the same console. Transfer logs actual reported byte counts; the UI does not invent a percentage when no total is available. Phases without finer-grained backend events remain indeterminate. Progress does not certify application readiness or physical two-Mac behavior.

The console opens into view when an operation starts; read-only reviews leave their review context available. Each operation starts a new transcript. At most 500 recent events and bounded text are retained, with an explicit omitted-event count. Auto-follow scrolls the inner console, without continually moving the page. The console remains readable in dark/light themes and the 800 × 600 minimum layout.

## Output and privacy boundaries

`execText` now supports an optional streaming callback while preserving its process-group supervision, cancellation and output/time limits. Dependency installers decode complete stdout/stderr lines, preserve split UTF-8, suppress private-key blocks and oversized lines, and cap forwarded output. The CLI uses a typed progress frame; ordinary JSON stdout remains machine-readable. The desktop main process validates the frame shape and filters it again before IPC delivery.

Known passphrases/environment secret values, credential-shaped assignments, authorization headers, common token formats and URL credentials/query values are filtered. ANSI/control sequences are removed; the renderer inserts text nodes. Filtering is best-effort: arbitrary unlabeled private application data or unknown/obfuscated secret formats may still appear. Project code still runs with user permissions only after the existing execution approval; the console is not a sandbox. Review logs before sharing them, especially because local paths may be included.

Logs are not automatically persisted. Copy and Save log are explicit user actions and filter the retained transcript again. Export uses a native save dialog, exclusive creation and mode 0600; an existing file is never overwritten. Clear affects the display only and is disabled during an active operation. Snapshot/archive formats, workspace trust, no-overwrite protections and approval requirements are unchanged.

## Verification and distribution

Evidence for this follow-up is in `dist/live-console/` and `dist/evidence/live-console.json`. Tests cover chunked credentials/Unicode, private keys, long/flooded output, output before process completion, direct API passphrase filtering, actual desktop install output, text-only rendering, native clipboard IPC without touching the user's clipboard, private export/no-overwrite, cancellation, bounded retention and auto-follow.

This is development source and a separate local preview. Existing published npm/GitHub 0.2.0 artifacts and installed applications are preserved. The local preview still uses bundle version 0.2.0; a new version is required before public distribution. Ad-hoc integrity is not Apple Developer ID signing or notarization. Earlier consolidated/hosted results describe their original source; only this follow-up's recorded tests establish the current evidence.

Fresh local results (2 November 2026): **64 tests PASS, zero skips/failures**, strict checks PASS; actual source and final packaged desktop console/install/copy/export/cancellation workflow PASS; **32 packaged layout combinations PASS**, zero renderer errors; **43 architecture/resource/signature-integrity checks PASS**; **3 actual-DMG checks PASS**. Existing same-host two-app TLS transfer and independent restore also passed. One rebuilt packaged smoke attempt failed its expected missing-configuration message assertion while checks were running concurrently; the diagnostic retry in isolation passed the full workflow. The original mismatched response was not captured, so its cause is not established. No new consolidated 19-stage or hosted CI result is claimed.

Final preview: `dist/live-console/desktop/DevTeleport-live-console-preview.dmg`, SHA-256 `b037c77340027957567f8d50b00ed06077151b52c2c1940b5e68ed48c04f9b98`. ZIP and verified checksums are in `dist/live-console/`. Screenshots: `console-running.png`, `console-complete.png` and `dist/ui-review/`. The original published DMG checksum is unchanged.
