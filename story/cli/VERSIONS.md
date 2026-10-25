# Story: running work keeps its version

Draft for review. As a person with agents and long runs, I want new commands to
use the new release while current work retains all its original code, helpers and
Node. The [contract](../../prompts/cli/versions.prompt.md) owns layout and retention.

- **AC1:** Runtime resolves one complete immutable version root, absolute Node/bin
  and optional client helper. An explicit root never falls back to current.
- **AC2:** A current flip leaves a live process and every later stage of its run on
  the saved runtime. The public pdd index projection keeps its existing shape.
- **AC3:** GC retains current, previous, launcher support, unfinished runs, live
  and restoreable managed sessions and pending upgrade/install intents, with Node.
- **AC4:** Partial, unreadable or changing reference inventories delete nothing.
  Recheck references under the install lock before any deletion.
- **AC5:** GC deletes only proven-unreferenced owned version/Node folders; it never
  deletes worktrees, journals, native sessions, caches, vaults or stock tools.
- **AC6:** Invalid identity/path/missing entry gives runtime_unavailable before
  process start. A block retains pinned work and does not upgrade it.
- **AC7:** A retained Runtime pins executable paths without freezing or creating
  an account override. Machine/tool account policy remains authoritative; permitted
  launch/runner model-effort inputs stay separate from Runtime resolution.

[Cases](../../vectors/cli/versions.json) cover multi-release retention and failure.
