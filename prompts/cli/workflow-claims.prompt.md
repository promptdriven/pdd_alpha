# One process per native session

Own `src/workflow-claims.mjs`. Draft for review. This public Alpha module owns
kernel exclusion for native sessions and controller/stage guards. Credential
selection stays outside it. Preservation: new generic contract, actual saved
session identity and no duplicate continuation through restore.

The module function `withWorkflowLock({path}, action, ports)` runs `action`
under an exclusive nonblocking kernel flock and releases on exit. Busy gives
`WORKFLOW_STAGE_BUSY` for the stage guard or `controller_busy` for controller
use; it never removes/replaces a lock inode. `inspectWorkflowLock({path}, ports)`
returns `held`, `free` or `unknown` without repair; unknown is never free.
`claimWorkflowSession({kind, nativeSessionId, owner}, ports)` returns an owned
claim handle or `{state: "busy" | "retired" | "uncertain"}`. These are proposed
local bindings. The stable `pdd-claim KIND:ID -- CLI ARGS…` entry uses this policy.

<details>
<summary>Claim lifetime, new sessions and successor authority</summary>

Existing native ids use `~/.pdd/claims/<kind>-<id>.lock`, exclusive flock held
across exec for the whole CLI lifetime. `kind` is codex or claude; id must be a
validated native id from Herdr/session history. Busy starts nothing and says
`<kind> session <id> already runs here`. PID files, stale timestamps and
unlinking a held lock are not exclusion. Mac and Linux must prove the actual
flock helper and descriptor inheritance; no Linux-only shell command fallback.
The C helper must expose Darwin flock and O_NOFOLLOW declarations while retaining
its POSIX feature level: define _DARWIN_C_SOURCE under __APPLE__ immediately after
_POSIX_C_SOURCE. Preserve the stable inode, no-follow open and cross-exec lock.

For a stage, `owner` is `{runId,attemptId,backendGen}` from the journal.
`nativeSessionId:null` is allowed only for this provisional owner, never as an
existing native session id. Other managed-session owners supply their durable
launch id and generation, without credentials.

Before a new native id exists, hold a provisional claim on the saved run,
attempt and backend generation. Record actual pane/terminal ids before first
prompt; never derive a native id from a process. Once Herdr reports the id,
acquire its session claim before releasing the provisional claim. If identity
cannot be proved, keep the original pending and send no second first prompt.

The journal is authority for a stage's current generation, actual account and
native session; non-stage managed agents use their launch record. Account policy
belongs to machine/tool Settings. A shared policy transition never permits two
working generations of one agent. Every restore path checks both saved generation
and current machine/tool policy revision, without treating an old actual-account
observation as an account preference. A replacement retires the old generation
before the successor may work and confirms the old process ended. A different
native id alone does not permit two working generations. Save successor intent,
old/new ids and the stopped proof; crash recovery reconciles them without a
blind resend. A held claim permits observation/reattachment to its actual owner,
never takeover. New processes increment backend generation, even on the same
native id. A new pane location alone is not a new process.

</details>

**Provisional key and promotion:** a stage with null native id uses
`~/.pdd/claims/stage-<runId>-<attemptId>-<backendGen>.lock`; a non-stage launch
uses `launch-<launchId>-<backendGen>.lock`. UUIDs and positive integer generations
are validated before path use. Module function
`promoteWorkflowClaim({claim,kind,nativeSessionId},ports)` acquires the native
claim while still holding provisional exclusion, durably binds the observed
native id to the same owner, then releases the provisional descriptor. Busy or
failed durability keeps provisional exclusion (and any newly acquired native
claim until safe resolution) and permits no prompt. Repeated
promotion returns only the same owner/id binding. No lock inode is unlinked.

**Cleanup/start exclusion:** `<commonDir>/pdd/run-lifecycle/<runId>.lock` is a
stable kernel guard outside the removable per-worktree gitDir. Acquire lifecycle
before controller and then stage guards. Drive briefly holds it while checking
nonarchived ownership and acquiring controller.lock, then releases lifecycle.
Attach holds it through acquisition/use of its stage guard. Cleanup holds it
through final checks, archive and physical removal, so no new drive/attach can
race. All locks are nonblocking; contention retains work. Mark archived ownership
in the common registry before releasing lifecycle. Never remove that guard inode.

Controller exclusion is `<runDir>/controller.lock`, held only while drive runs.
The stage attachment/acceptance guard is a different kernel lock scoped by
common repository and run. Same-call nested operations may reenter; independent
commands may not. Attachment holds it through detach. No guard is held through
all observation polling. No private account, fleet sign-in or hosted service is
needed by any generic claim.

## Dependencies

- [Story](../../story/cli/WORKFLOW-CLAIMS.md) and [cases](../../vectors/cli/workflow-claims.json): verification; expected outcomes, not observed results.
- Node process/filesystem facilities plus a Mac/Linux flock helper with
  descriptor inheritance: required runtime dependency, implementation and
  cross-exec proof still pending. Missing support returns `unsupported`.
- Native session ids and owner/generation supplied by the caller's durable
  journal or managed launch record: required runtime input. No required
  dependency back to the runner; this module never decides stage progression.
