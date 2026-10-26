# Story: PDD does not depend on system Node

Draft for review. As a person changing my shell or system Node, I want existing
PDD services and runs to keep their recorded working Node. The
[contract](../../prompts/cli/owned-node.prompt.md) owns runtime installation.

- **AC1:** A trusted matching artifact installs under tools/node; executable and
  runtime descriptor use absolute real paths. No system Node or PATH fallback.
- **AC2:** Digest/signature mismatch, unsupported platform/architecture, path
  escape or conflicting existing bytes execute nothing unverified and preserve
  active pointers and the existing runtime.
- **AC3:** Equal verified bytes are reused without rewrite. Interrupted download
  or disk-full leaves only owned incomplete staging eligible for cleanup.
- **AC4:** Bootstrap works without Node/npx and retains a known-working launcher
  support runtime even if a candidate Node cannot execute.
- **AC5:** Existing runs, sessions, fallback and launcher retain their referenced
  Node folders. Only version GC removes a proven-unreferenced Node.
- **AC6:** stageOwnedNode verifies temporary Node outside update.lock;
  ensureOwnedNode publishes/reuses it under the setup/activation lease without
  network I/O, preserving final absolute Runtime paths.

[Cases](../../vectors/cli/owned-node.json) are synthetic artifact expectations;
no download, stock-tool update or live process is performed.
