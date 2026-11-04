# DevTeleport V0.2.2

Native Apple Silicon development release candidate. Desktop, bundled engine, CLI package and VS Code extension identify as **0.2.2**. The application identifier remains `dev.devteleport.desktop`; encrypted snapshot formats 1 and 2 remain supported.

## Changes since 0.2.1

- **Retry dependency installation inside the app.** See each independent installation's result, select failed or unfinished work, review the current project and approve retry in the same restored folder. Earlier successful installs remain visible as history. Recovery survives app restart, and cancellation stops installer descendants while preserving restored source.
- **Collect dependencies across project types.** Detect supported Node.js, Python, Java, Go, Rust, Ruby, PHP, .NET and Dart/Flutter metadata. Show identified library declarations and install commands. Native package managers resolve and download direct/transitive libraries after approval.
- **Complete Node development installation.** Preview runtime, development, optional and peer declarations. Explicit npm/pnpm options prevent inherited production settings from silently omitting development libraries. Yarn/Bun plans retain their own lock policies.
- **Isolated Python dependencies.** pip uses an owned private virtual environment. uv/Poetry adapters route to that environment with runtime auto-download disabled. Unsafe local requirements paths, unowned environments and unexpected interpreter links are refused.
- **Selective setup after files-only restore.** Install the projects that are ready while unrelated unselected projects still need tools or manual setup. Co-located ecosystems have separate installation keys and statuses.
- **Approval bound to current inputs.** A review binds project metadata, canonical path and native tools; desktop approval also binds target identity, selected installations and tool-directory settings. Changing the plan requires another review. No execution approval, complete plan or script body is saved in recovery history.

Static library names are a preview rather than a complete resolved graph. Managers retain platform, optional-feature and script/security policies. Required runtimes, compilers, services and private-feed credentials must be configured separately; applications are not started automatically. Swift/Elixir, Pipenv/legacy Python and ambiguous configurations receive manual-setup guidance. See [the adapter coverage matrix](DEPENDENCY-COLLECTION.md) and [dependency recovery](DEPENDENCY-RETRY.md).

## Validation and distribution

The reference host exercised real offline npm/pnpm libraries, Python private-environment wheels, a co-located Node/Python source-removal restore and selective retry, and a Ruby/Bundler local-gem install. Several other adapters have planning/guarded-dispatch tests without actual native SDK/network acceptance; do not infer universal framework compatibility.

Final release validation, the exact named installer checksum and outstanding gates are recorded in [the 0.2.2 validation report](RELEASE-0.2.2.md).

The ARM64 app is ad-hoc signed for local code/resource integrity. It is not Developer ID signed or notarized. Downloaded-app Gatekeeper acceptance, physical two-Mac/fresh-install acceptance, hosted CI for this source and secure update installation remain separate gates. Automatic executable updates remain disabled. Publication of this release and its CLI package is a separate action; local packaging does not replace public downloads or installed applications.
