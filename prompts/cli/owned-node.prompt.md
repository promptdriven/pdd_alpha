# PDD-owned Node

Own `src/owned-node.mjs`. Draft for review; new work, behavioral refinement.
Install and resolve the exact verified Node runtime under `~/.pdd/tools/node/`
so setup, updates and long runs survive changes to the person's system Node.
Inputs are a trusted release's Node artifact descriptor and local platform.
Outcomes are an executable absolute runtime path or an actionable local error.
Do not update system Node, shell profiles, Codex, Claude or Herdr.

Module function `stageOwnedNode({home, artifact, platform, arch, transactionId}, ports)`
returns `{stagedNode, nodeVersion, artifactIdentity}` or `{code, next}` using only
transaction-owned temporary paths outside update.lock. Module function
`ensureOwnedNode({home, staged, lease}, ports)` publishes/reuses that verified
runtime in a short setup/activation critical section and returns
`{node, nodeVersion, changed}` or `{code, next}`. No network/download runs under
that lease. The artifact declares
version, platform, arch, URL, integrity and trusted signature/checksum authority.
The release supplies those values; do not select "latest". Current Alpha needs
Node >=22.16.0; also satisfy the target package's engine floor. Reject an invalid
descriptor before download. Private extraction and download machinery are free.

<details>
<summary><strong>Verification, bootstrap and retention</strong></summary>

Use only the supported Mac/Linux platform and architecture named by the artifact.
Unsupported combinations give `unsupported_runtime` before active changes. WSL
uses Linux artifacts only when WSL support is enabled; it is not an initial-launch
requirement. No unverified fallback to an arbitrary PATH Node or another platform.

Download into a task-owned temporary folder under the same filesystem. Require
the artifact's trusted integrity/signature check before extraction/execution;
reject path traversal, escaping links and unexpected executable paths. Execute
only the verified staged Node for its local version/architecture check. During
activation revalidate its artifact identity, then atomically publish the complete
folder and record its final absolute real executable path in
Runtime. Reuse an equal, verified installation with `changed:false`; a conflicting
folder is not silently accepted or overwritten. Failure leaves current, previous
and any existing Node unchanged, and returns `runtime_verification_failed`,
`runtime_io` or `runtime_download_failed` with one next step.

A stock-machine bootstrap performs equivalent download/verification without
requiring node, npm or npx. Normal commands, services, controllers, stage children
and detached updaters use absolute PDD Node paths from their selected Runtime.
The stable launcher retains a known-working support runtime separately from a
candidate Node; failure to exec the candidate cannot disable recovery. Preserve
all Node folders referenced by retained package runtimes or launcher support.
Only the versions owner may garbage-collect a proven-unreferenced Node.

</details>

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): authoring.
- [Install lock](update-lock.prompt.md): required for generation/runtime; every
  runtime publication holds its lease; staging downloads do not.
- [Versions](versions.prompt.md): required for generation/runtime; Runtime path
  mapping and the retention authority.
- [Story](../../story/cli/OWNED-NODE.md) and [cases](../../vectors/cli/owned-node.json):
  verification.
- Runtime: local archive, integrity/signature and HTTPS facilities; an explicit
  trusted artifact table is a required release input. Missing trust material
  gives `runtime_verification_failed`, never trust-on-first-download.
