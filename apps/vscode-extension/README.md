# DevTeleport for VS Code

Inspect, capture, restore and verify encrypted development workspace snapshots through the DevTeleport CLI. Open the DevTeleport activity sidebar to run commands and see the latest operation status. Full JSON reports appear in the DevTeleport output channel.

Install Node 24 and the DevTeleport CLI package separately. Set `devteleport.nodePath` to the Node executable and `devteleport.cliPath` to the absolute installed `apps/cli/main.js` (or `main.ts` in a source checkout). All file processing happens locally through this trusted executable.

Capture asks for a name, output folder and passphrase, offers to save dirty files, then records saved editor tabs in `.vscode/devteleport-session.json`. This generated file becomes part of your working tree. Restore authenticates the snapshot, shows a plan and requires a new destination. Existing destinations are never overwritten. After opening a trusted restored folder, the extension offers to reopen saved files.

The extension does not migrate live processes, unsaved buffers, debugging execution, arbitrary extension state or terminal sessions. Dependency installation and database restoration require explicit CLI approval. Snapshot history lists encrypted files in the current folder; use the CLI to list another snapshot directory. Actual VS Code Insiders extension-host tests cover commands, cancellation, dirty-file saving, saved-tab reopening, and untrusted-workspace capture refusal.
