# Contributing and releases

Use Node 24 and npm. Core CLI tests need no install; GUI packaging needs `npm ci`. Changes to extraction, encryption, credential handling and process execution require focused adversarial tests. Preserve no-overwrite behavior. Do not substitute mocked process output for integration verification. Keep support claims aligned with observed results.

Before a release, run syntax/core tests, PostgreSQL and Docker configuration integration, the Express independent-directory test, CLI package installation and smoke tests, VSIX packaging and extension-host testing, and interactive desktop verification. Run on physical Apple Silicon and Intel machines before claiming those platforms verified. Test cross-device transfer with the source offline. CI workflows provide repeatable build instructions, not retrospective validation.

`npm run package:cli` builds an npm tarball. `npm run package:extension` creates a VSIX. `npm run package:desktop -- --publish never` requests unsigned arm64/x64 macOS DMGs. Desktop signing and notarization require developer credentials and explicit authorization. No release script publishes automatically. Use an explicit reviewed version bump, inspect artifacts for secrets, hash artifacts and attach accurate test evidence before publishing.

Future work should introduce streaming bounded I/O, stronger configuration schemas and strict TypeScript checking throughout the engine, a desktop bundled backend runtime, authenticated inventory comparison, cancellation/recovery journals, richer PostgreSQL adapter policies, explicit volume adapters, extension-host automation and real-device coverage. Network transfer should remain absent until pairing, authentication, integrity and interruption recovery are independently verified.
