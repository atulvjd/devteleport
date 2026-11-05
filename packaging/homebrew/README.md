# DevTeleport Homebrew tap

Install the standalone DevTeleport CLI:

```sh
brew install atulvjd/devteleport/devteleport
devteleport help
```

The formula downloads the immutable npm 0.2.2 CLI tarball and verifies its SHA-256. It installs Homebrew Node and does not install the Electron desktop app. It runs no project install hooks during formula installation. Project dependency setup still requires its own review and explicit execution approval.

Git, language runtimes/package managers, PostgreSQL and Docker are needed only for the operations using them. The formula does not install all SDKs or migrate running processes. This development release retains its documented acceptance limits.

The formula's test captures an encrypted format 2 snapshot, removes its disposable source, restores independently and verifies against the original archive.

License: MIT. Source and issues: https://github.com/atulvjd/devteleport
