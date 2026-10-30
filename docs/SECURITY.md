# Security model

Snapshots are encrypted at rest and remain encrypted during manual file transfer. No data is uploaded by DevTeleport. A long unique passphrase is essential. Environment-supplied passphrases can be visible to privileged local processes; prefer interactive input for CLI use. No keys or credential URLs are logged intentionally.

The snapshot reader authenticates before decompressing, limits compressed and expanded sizes, validates version/type/checksum/path metadata, rejects duplicate and case-colliding names, and disallows absolute paths, traversal and ambiguous separators. Files cannot be extracted beneath a symlink. Symlinks must reference a captured nonsymlink entry through real snapshot directories. Git hooks, config, alternates and Git internal links are forbidden. Snapshot code never executes during ordinary file restoration.

Known credential filenames and Git ignored files are excluded. This does not detect arbitrary embedded credentials, historical secrets in Git objects, confidential database data or secrets in saved editor settings. Inspect omissions and your project before transfer. Git local config is excluded entirely rather than attempting risky credential redaction.

Source files are read twice to detect ordinary concurrent changes; hostile local writers and filesystem races are outside the security boundary. The destination parent directory must be trusted and not writable by hostile users. Source owners must be trusted. Database capture invokes pg_dump with environment credentials and restricted temporary directories. Dumps can contain arbitrary SQL: database restore requires trusted dump provenance and explicit approval. Localhost/production-name checks are guardrails, not production discovery.

Default restoration neither installs packages nor starts services. `--approve-execution` deliberately permits npm lifecycle scripts. `--approve-db` deliberately permits SQL execution against the configured development database. Compose files are untrusted configuration; review before manually starting services, which may expose host paths, networks or privileged containers.

Snapshot limit: 128 MiB aggregate decoded files/dumps, 32 MiB per file/dump, 50,000 filesystem entries, 256 MiB decompressed JSON. Base64 and double-reading increase memory usage substantially. Large workspaces need exclusions or a future streaming format. Secret keys are cleared from derived-key buffers after use; JavaScript strings and runtime copies cannot be guaranteed erased.

No third-party security audit, signing, notarization, public-key signatures, resumable peer transfer, live-memory migration or universal database sandboxing is claimed. Report security issues privately to repository maintainers using a channel they explicitly publish; no fabricated reporting address is supplied.
