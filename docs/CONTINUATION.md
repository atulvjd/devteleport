# Release continuation — 0.2.0

For a new session, start with [ACCOUNT-HANDOFF.md](ACCOUNT-HANDOFF.md) and the copy-paste [NEXT-SESSION-PROMPT.md](NEXT-SESSION-PROMPT.md).

Read [STATUS.md](STATUS.md) and [APPLE-SILICON-RELEASE.md](APPLE-SILICON-RELEASE.md) first. Preserve the stable bundle identifier `dev.devteleport.desktop` and format 1 compatibility. Never describe the unsigned candidate as production certified.

After any source/UI change, run `npm run check`, `npm test`, rebuild with `npm run package:desktop -- --publish never`, then run `npm run verify:apple-silicon` on a native ARM64 Mac with the documented PostgreSQL, Docker and VS Code prerequisites. Inspect every stage and raw log in `dist/evidence/`; skipped prerequisites are not passes. Run `npm run checksums` only after final artifact generation. Do not reuse evidence for stale binaries.

Remaining work requires explicit resources: authorized Developer ID/notarization credentials, a second physical Mac, fresh-install OS acceptance, trusted signed update infrastructure, remote push/run authorization, and exhaustive fault-injection/manual acceptance. `npm run verify:signing` must remain BLOCKED for unsigned builds. No automatic publication or security bypass is authorized.

Recovery is per component, not a distributed transaction. Preserve failed-operation journals and review `devteleport recover` previews before approving cleanup. Never delete existing projects/databases/volumes to make a test pass. Format 2 large-file support does not remove the named-volume adapter limits.

For the current UI work read [UI-REFRESH.md](UI-REFRESH.md). The native gate now includes packaged visual checks. Run `npm run test:desktop` for functional reviews/capture/restore and `npm run test:desktop:visual` for both themes at standard/minimum sizes; inspect screenshots rather than relying on layout assertions alone. Latest local rebuilt candidate passed 19 stages with 46 tests and 32 visual layouts. Manual assistive-technology and physical-device acceptance remain outstanding.
