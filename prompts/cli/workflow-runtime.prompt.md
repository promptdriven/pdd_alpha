# Frozen run inputs and runtime

Own `src/workflow-runtime.mjs`. Draft for review. This module freezes the actual
inputs and records the executables that let a run continue after an update.
It does not select accounts, start processes or advance a stage. The module
bindings below are the contract behind `pdd workflow upgrade` and the runtime readers; preservation is behavioral refinement of the
runner's saved identity, accepted artifacts and no-silent-input-change rules.

The module functions are `freezeWorkflowInputs({runDir, guidance, definition,
runtime, seed}, ports)`, `readWorkflowRuntime({runDir}, ports)` and
`checkWorkflowRuntime({runDir, releasePolicy = null}, ports)`, and
`listWorkflowRuntimeReferences({entries},ports) -> {complete,references}`.
The census returns every unfinished run and pending upgrade runtime; any
unreadable/changing entry makes complete false. Packaging combines it with
managed live/restoreable session references before collection. Freeze returns the saved record;
read returns it; check returns `{ok, code}`. Missing, corrupt or mismatched
frozen files fail closed with `frozen_input_invalid`; an unavailable recorded
executable gives `runtime_missing`, never a fallback to `current`.

<details>
<summary>Frozen bytes, runtime fields and retention</summary>

`seed` is `{repository,issue:{number,url,title,body},baseRef,baseSha,
sourceRoot,root,project?,launchSelection?}` from the runner's verified issue and physical assignment;
paths and baseSha are the actual assigned values. It supplies the task/repo/base
fields below; optional project and launchSelection are the resolved name/id and validated machine/tool model/effort pair. Freeze them as task inputs, not account preferences or package Runtime fields. Later Settings edits cannot change the saved pair. This module performs no guessed issue lookup or undeclared read.

Before the first native effect, save `<runDir>/frozen/` with the full guide-first
guidance, selected workflow JSON and all its declared Markdown, source paths,
actual SHA256 values and resolved definition digest. Freeze the canonical issue/task payload, repository identity and pinned base revision with those inputs; later issue edits do not silently change this run. Retain the exact stage
context/instructions separately per attempt with its assigned worktree and
handoff path. Exclusive creation, file fsync and directory durability precede
`run.started`; incomplete creation authorizes no launch. Do not overwrite an
existing freeze. Freeze no credentials or inherited environment.

The journal's `runtime` is the caller-supplied immutable installed Runtime
with additive `packageRoot`,
`codexVersion`, `claudeVersion`, `herdrVersion`, `cacheSchema`. `packageRoot` aliases the
same absolute `versionRoot`; `credentialHelper` is the absolute version-specific
client helper, or null for Alpha alone. Missing client cache schema is null.
Required caller interface:
`Runtime = {v:1,releaseId,versionRoot,node,bin,pddVersion,alphaDigest,
clientDigest,nodeVersion,credentialHelper}`. All paths are resolved absolute
paths; bin is versionRoot/bin/pdd.mjs; clientDigest and credentialHelper are null
on Alpha alone. The caller supplies a verified descriptor; this module does
not resolve current, select release artifacts or perform their verification.
Preserve every field and any unknown additions when freezing or upgrading it.
The package's Runtime owns release/Node paths and digests; this module owns
observed stock tool versions and the frozen input. A tool not selected may have
a null version. The run records the observed Codex, Claude, Herdr and owned Node versions.
Each recovery/compatibility spike and lab run uses and records the supported
stock-version matrix; a historical run record is not the current tested-with
list. Stock versions are evidence, not promises that PDD retained
vendor binaries. Every stage/controller uses this record, including its helper.
`status.json.runtime` is a derived copy; index `pdd:{node,bin,version}` remains
its compatibility projection. Missing or conflicting aliases fail validation.


Later edits to the original guide or recipe do not invalidate this run. Read
and validate its frozen bytes instead. Changes to accepted proposal files,
HEAD, ancestry, assignment or the current execution input still invalidate their
acceptance. New turns use the saved full guide and stage instructions.

Retain version folders, owned Node, frozen files and artifacts while any live
session or unfinished run references them, including WAIT and human waits.
Unknown fields and raw unknown control states survive read/modify/write;
an unknown control state allows no effect.
Compatibility must cover every retained runtime, not just adjacent releases.

</details>

## Explicit run upgrade

The module function
`upgradeWorkflowRuntime({runDir, expectedRev, target}, ports) -> {state, code}`
binds `pdd workflow upgrade RUN_ID`. `target` is the verified installed Runtime
shown to the person; `expectedRev` is the positive safe integer wait revision
that person reviewed. The CLI resolves the exact indexed runDir and target,
shows old/new runtime identities and requests confirmation before this call.
Cancel has no effect. The command does not resume the run.

<details>
<summary>Upgrade guard, intent and committed runtime</summary>

Require the caller's `ports.withUpgradeGuard({runDir}, action)` to hold stable
lifecycle, controller and stage exclusion for the whole transition. It supplies
`{state, appendUpgrade}` to action only after a strict full-journal read and
physical assignment validation. `appendUpgrade({event, upgradeId, expectedRev,
oldRuntime, newRuntime})` is the controller-owned durable journal writer; this
module never appends journal bytes independently. Missing ports refuse
`unsupported` before writing. The guard cannot be a no-op.

Before a new transition, reconcile any intent with the same runDir, expectedRev
and exact target release/digests. A completed identical request returns upgraded
before stale checks; an uncertain one remains recovery_required. A reused wait
revision with a different pending target refuses rather than replacing the intent.
Recheck a stopped stage boundary and current `state.rev === expectedRev` under
that guard. A live turn/controller, attachment, unknown control state, pending
send/launch/cleanup or unresolved external effect refuses `run_not_stopped`.
A revision mismatch refuses `stale_decision`. Invalid/unavailable target runtime
refuses `runtime_missing` or `runtime_blocked`. Keep all accepted artifact pins,
worktree/session identity and frozen inputs; a target that needs different
context refuses until that context has been explicitly reviewed. Never reload
changed source files as the new context without that review.

Save old/new runtime identities and a unique upgrade id in a durable upgrade
intent before any change to the active record. Await controller journal
`upgrade.intent`, then `upgrade.committed`; only the committed journal record
selects the new runtime. The committed record gives the stopped wait a new
revision, so an older approval cannot apply to the changed runtime. Preserve
unfinished-run/session references to both runtimes while the intent is pending.
After commit, status is a derived write owned by the controller.

Return `{state:"upgraded",code:null}` only for a durable commit. A repeat of the
same resolved intent reports that result without another transition; a changed
target/binding refuses. A pre-effect refusal returns state `refused` with its
code. Uncertain durability returns `recovery_required`, code `upgrade_uncertain`;
recovery reads the existing intent and journal and selects only the durably
committed side. Before commit it keeps the old runtime; it never starts an agent
or advances the run to make the upgrade complete. A machine update alone never
upgrades a run.

</details>

A run pinned to
a blocked release keeps its files/runtime and gets Needs you: Upgrade run.
Do not migrate it or kill a running stage merely because current changed;
version GC cannot remove it. Report the blocked-runtime advisory in status for
the person to review at the next safe boundary.
`releasePolicy` is null or `{blocked:[releaseId,...]}` supplied from verified
local release state by the updater owner; this module trusts no relay hint or
unverified file. A matching saved release returns `{ok:false,
code:"runtime_blocked",next:"Upgrade run"}` without changing the run. Null
means no blocked-release information, not proof of compatibility. Only the
controller may journal runtimeNotice from this result; the updater never writes
run state.

## Dependencies

- [Story](../../story/cli/WORKFLOW-RUNTIME.md) and [cases](../../vectors/cli/workflow-runtime.json): verification; expected outcomes, not observed results.
- [Versions](versions.prompt.md): navigation-only owner of installed Runtime
  creation and collection. The exact caller-supplied Runtime interface above is
  required generation/runtime input; this module does not import the versions
  module or require its reference-census consumer context.

- [Definition loader](workflow-definition-loader.prompt.md): required for
  generation and verification of selected immutable recipe inputs.
- [Guidance](guidance.prompt.md): required for generation/runtime to obtain
  complete guide-first bytes at initial freeze, never for replacing a freeze.
- Node filesystem, path and crypto built-ins: runtime durability and hashes.
  `ports` supplies filesystem operations for failure controls. No network.
