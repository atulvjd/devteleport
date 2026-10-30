# Architecture

`packages/core/index.ts` is the single public engine, using Node built-ins only. Keeping one dependency-free package avoids a web of empty packages in an initial release. It exports inspect, capture, readSnapshot, validateManifest, restore, verify, composePlan and history. File enumeration, validation, encryption and tool execution remain private helpers. macOS/Linux filesystem conventions are assumed. Windows requires a separate tested adapter.

`apps/cli/main.ts` parses a strict command vocabulary, obtains passphrases, prints JSON and maps errors to exit status. Desktop and extension invoke this executable without a shell. They never receive arbitrary shell instructions from the archive.

`apps/desktop` uses Electron main-process IPC with a sandboxed renderer. Only fixed operations and native chooser dialogs are exposed. PostgreSQL restore and npm script execution are intentionally CLI-only review steps. The external Node executable is selected by trusted environment, not snapshot content.

`apps/vscode-extension` uses public workspace, tab and document APIs. Settings select a trusted CLI installation. No project-supplied command executable is used. Session paths are bounded to the trusted restored workspace.

## Format 1

A `.dtp` file is a fixed binary envelope: four ASCII bytes `DTP1`, 16-byte random salt, 12-byte random nonce, 16-byte GCM tag, then encrypted gzip-compressed UTF-8 JSON. AES-256-GCM authenticates payload and fixed format identifier. Scrypt parameters are fixed (`N=32768`, `r=8`, `p=1`, 32-byte key). There is no unauthenticated user-controlled KDF cost.

The versioned manifest contains actual platform/runtime/Git metadata, file type/mode/size/SHA-256/base64 bytes, database dump bytes/checksums/tool versions, exclusions and support descriptions. Database connection URLs and encryption secrets are absent. Remote repository configuration is not copied. Gzip expansion, record counts, individual payloads and total bytes have hard limits. This in-memory format is intended for small development projects; streaming format work is tracked separately.

Restoration decrypts and validates all records before writing any destination files. A private sibling staging directory receives directories, regular files, then safe links. A new destination is atomically claimed with exclusive mkdir before entries are moved in. Failures before post-actions clean only the newly claimed output. Existing targets are always rejected. Abrupt process termination may leave an incomplete new directory; see troubleshooting.

The restored `.devteleport/inventory.json` contains hashes and metadata, never archived file or dump payloads. Verification compares expected entries but permits extra files. Git may refresh index stat caches after restoration; if index bytes differ, verification compares canonical staged entries through Git with fsmonitor/hooks disabled, global configuration suppressed and Git environment overrides removed. Changed staged content still fails. The inventory is editable local metadata; it is not a cryptographic signature or proof against a malicious local user. Re-authenticate the original archive for authenticity relative to its passphrase.

## Future compatibility

Unknown format versions fail closed. There are no speculative migrations. A future reader must explicitly support each version and migrate only validated manifests. Signatures and signer identities are not implemented. Any passphrase holder can create an authenticated archive; GCM does not establish author identity.
