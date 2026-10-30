# Streaming snapshot format 2

Format 1 remains supported for capture through `--format 1` and for automatic restore/inspection. CLI and desktop capture default to format 2; the library capture API retains its old default unless `{format:2}` is selected. Existing format 1 files are not modified.

## Envelope

The uncompressed binary envelope is `DTP2` (4 bytes), random salt (16), random IV (12), ciphertext, then GCM tag (16). AES-256-GCM authenticates the entire 32-byte header as AAD. Scrypt parameters are fixed at N=32768/r=8/p=1, 32-byte key, 64 MiB maximum KDF memory. No attacker-selected KDF work factor exists.

The plaintext is a four-byte unsigned big-endian metadata length, bounded UTF-8 JSON metadata, then exact file/database/volume bytes in manifest order: regular project files, PostgreSQL records, Docker volume records. File contents are out of line, not JSON/base64. Modes, paths, sizes and incremental SHA-256 checksums are recorded. Directories/symlinks carry no body. There is no archive compression or decompression-bomb layer. Small database dumps and named-volume payloads can have their own supported internal compression.

Limits: 16 GiB per file/database payload; 32 GiB aggregate bytes; 16 MiB metadata; 50,000 filesystem entries; 50 adapters per component kind. The aggregate cap stays well below AES-GCM's per-message length limit. Named-volume adapters retain their separate 32 MiB compressed/128 MiB expanded limits. Memory is bounded by metadata, 256 KiB stream buffers, crypto/runtime allocation and the existing bounded volume adapter, rather than total project/database size.

## Capture

Metadata-only enumeration uses the existing exclusions and safe Git/file layout checks. Capture streams each regular file through hashing/secret scanning into an owner-private staging directory, validates inode/size/mtime/ctime before/after reads, checks Git/LFS objects, exports PostgreSQL to a private file, and streams all staged payloads through encryption. A final second enumeration/stat check rejects ordinary concurrent source changes. Output is fsynced and published via exclusive hard link; partial names cannot overwrite a final archive. User review scans high-confidence secret patterns before capture. Source changes remain non-transactional across files, databases and volumes: stop writers.

## Authentication before trust

Restore streams decryption into a private 0700 directory and 0600 temporary payload. GCM must validate before metadata is parsed or any destination files are created. Metadata is bounded and validated with the existing path/collision/symlink/reserved-name validator plus streaming size/component checks. Exact plaintext lengths and each body checksum are checked before destination publication. A new destination is exclusively claimed; source files are verified independently. Approved SQL/package/container actions remain separate post-actions.

Private plaintext staging consumes disk space. Free-space preflights and database export limits reduce resource exhaustion; concurrent unrelated disk writers can still cause an I/O failure. Temporary storage is permission-restricted, not guaranteed physically erased or independently encrypted. FileVault/storage policy belongs to the host administrator.

## Recovery

Owner/PID-tagged journals identify capture, authentication and restore stages. Normal failures clean private staging; abrupt termination may retain evidence. `recover DIR` inspects it. `recover DIR --cleanup PRIVATE_STAGE` previews eligible cleanup; add `--approve-cleanup` to remove only a recognized inactive operation's private stage and its matching unpublished partial. Active PIDs, symlinks, unrecognized journals and arbitrary project directories are refused. A new partial restore directory or failed post-action requires human review; no distributed rollback across files/PostgreSQL/Docker is claimed.

Detached Ed25519 signatures hash either envelope version incrementally. Archive-backed verification uses authenticated metadata and streaming file hashes. Format 1's in-memory limits remain unchanged; format 2 does not retroactively enlarge its decoder.
