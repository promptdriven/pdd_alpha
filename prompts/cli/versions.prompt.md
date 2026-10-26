# Installed versions and retained runtimes

Own `src/versions.mjs`. Draft for review; new interfaces, behavioral refinement.
Given an installed release, a selected entry and authoritative runtime references,
resolve one immutable runtime or collect only proven-unused versions. Own the
install layout and `runtime.json`; do not select releases or change run journals.
This lets running work keep its code while new commands use a newer release.

All bindings below are module functions. `resolveRuntime({home, versionRoot?})`
returns `Runtime`; omitted root resolves `~/.pdd/current` once. An explicit root
never falls back to current. `collectVersions({home, references}, ports)` returns
`{removed, retained, code}`. Ports supply filesystem, process/reference inventory
and the install lock. Missing or invalid runtime gives `runtime_unavailable` with
no process start. Internal helpers and archive representation are free.

<details>
<summary><strong>Install layout and required Runtime interface</strong></summary>

| Path under `~/.pdd/` | Contract |
|---|---|
| `launcher/pdd-launch` | Stable entry and its complete support context; outside all version folders |
| `versions/<release>/` | Alpha package at the root (`bin/pdd.mjs`, `src`, docs, skill, workflows); optional `client/` package beside it |
| `versions/<release>/bin/pdd-cred` | With client only: version-specific entry to that folder's credential helper; no current lookup |
| `versions/<release>/runtime.json` | Immutable resolved runtime descriptor |
| `current`, `previous` | Symlinks to complete version folders; changed only under the install lock |
| `tools/node/<nodeVersion>/` | PDD-owned verified Node; retained independently of current |
| `install/record.json`, `update.lock` | Durable install state and short setup/activation exclusion |
| `update/staging/<transaction>/` | Unique temporary verified downloads; not current and never GC'd while its transaction is live |

`Runtime = {v:1, releaseId, versionRoot, node, bin, pddVersion, alphaDigest,
clientDigest, nodeVersion, credentialHelper}`. Paths are absolute real paths;
`bin` is `<versionRoot>/bin/pdd.mjs`. `clientDigest` and `credentialHelper` are
null for Alpha alone. Digests and releaseId come from verified release inputs;
the same releaseId cannot name different bytes. Node is under `tools/node/`.
`runtime.json` is written only after verification, before the folder is exposed.
Reject path escapes, broken links, missing entries and inconsistent identities.
Treat files inside an installed folder as read-only after installation.

</details>

## Runtime pinning and collection

Every new process resolves its root once, then imports code, guidance and helpers
from that root. A controller and all its later stages use its recorded Runtime.
Changing current never changes an existing process's root. Preserve the existing
runs-index `pdd {node, bin, version}` projection using this runtime's values.
Runtime pins code, Node and helper paths, not account selection. A retained run
continues to use its machine/tool account setting through the policy owner;
retaining a runtime cannot create an agent/run account override. Model/effort
defaults and any permitted start-of-run model/effort override are execution
inputs owned by the launch/runner contracts, not fields selected by this module.

Collection requires the install lock and a complete, consistent reference census.
The runner's part of that census is `listWorkflowRuntimeReferences` from
[frozen runtime](workflow-runtime.prompt.md); `complete:false` from it is
`references_uncertain`. Managed live and restorable session references come
from the client when installed.
Retain current, previous, the stable launcher's own support runtime, every
unfinished run (including WAIT and human waits), every live managed session,
every session still eligible for restore, and every pending install or run-upgrade
intent. Retain each referenced Node too. Unknown, unreadable or changing references
give `references_uncertain`; delete nothing. Recheck references under the lock
before deletion. An older referenced version remains retained across any number
of releases. A machine block does not delete a pinned runtime or upgrade a run;
surface Needs you: Upgrade run. An upgrade is an explicit recoverable journal
transition at a stage boundary, outside this module's authority.

Collection removes only unreferenced owned version/Node folders. It never removes
worktrees, journals, session logs, caches, vaults or user-installed tools.
Shared file readers must preserve unknown data on rewrite and pause on unknown
control states. Retention is not proof of cross-version compatibility: activation
needs compatibility evidence for all retained consumers, including actual fallback.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): required for authoring.
- [Story](../../story/cli/VERSIONS.md) and [cases](../../vectors/cli/versions.json):
  required for verification; synthetic expectations, not runtime inputs.
- [Frozen runtime](workflow-runtime.prompt.md): required for runtime; the
  runner's reference census and the `pdd {node, bin, version}` projection.
- Runtime: local filesystem realpath/symlink/atomic-rename facilities. Callers
  supply the lock and authoritative reference census; no network or fleet required.
