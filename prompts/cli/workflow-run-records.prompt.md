# Workflow run records

Own `src/workflow-run-records.mjs`. Status: draft for review.

This module writes two small derived files about local workflow runs and reads
them back leniently. The **runs index** `~/.pdd/runs/index.jsonl` tells a
reader where each run's files are on this machine. The **run status file**
`<runDir>/status.json` is a short summary of one run. PDD Link reads both, so it
does not scan repositories or parse the private journal. For runs without a
status file, the module also holds lenient readers of the last journal line,
the journal records after a sequence number, and the issue assignment files.

Inputs: the runner's journal state object `{seq, event, state}` (see the
[workflow runner](workflow-runner.prompt.md)), a few extras the runner knows,
and the ports `fs` (node:fs/promises subset), `home` and `randomBytes(n)`.
Outcomes: appended index lines, an atomically replaced status file, and reader
results of the form `{value, warnings}` or `{entries, dropped}`.

**Preservation:** new work, behavioral refinement. The named exports, file
paths, field names and observable results are the contract. Internals are free.

The journal stays the only owner of run state; the index and the status file are derived views that nothing reads back as input to the run.

## Exports

All are module functions of `src/workflow-run-records.mjs`:

| Export | Result |
|---|---|
| `appendRunIndex(entry, ports)` | `{ok: true}` or `{ok: false, code}`; never throws |
| `readRunIndex(ports)` | `{entries, dropped}` |
| `runStatusFromState(state, extras)` | a status object; pure, never throws |
| `writeRunStatus(runDir, status, ports)` | `{ok: true}` or `{ok: false, code}`; never throws |
| `readRunStatus(runDir, ports)` | `{value, warnings}` |
| `readJournalLast(runDir, ports)` | `{value: {seq, event, state} or null, warnings}` |
| `readJournalSince(runDir, afterSeq, ports)` | `{records: [{seq, event, decisionId}], complete, warnings}` |
| `readAssignedRuns(commonDir, ports)` | `{entries, dropped}` in the index entry shape |

## Records never steer the run

The [workflow runner](workflow-runner.prompt.md) calls the two writers. A
write is a side output only:

- `appendRunIndex` once, right after the `run.started` journal record is
  durable and before the first stage effect.
- `writeRunStatus` after each durable journal record, and once when the
  controller exits. Only a `pdd workflow drive` controller (or the initial preparation command) that holds
  the run's controller lock and has loaded or created that run's journal
  writes it. A heartbeat may refresh status under that same lock without a new journal record. A command that did not get the lock, the report for an issue that
  already has a run, and `pdd workflow attach` write nothing.
- The runner awaits each write before its next journal record, so the status
  file's `journalSeq` is never higher than the journal's last `seq`.

**Failed write rule.** When a writer fails for any reason (I/O error, full
disk, bad input, a value that does not serialize), it returns
`{ok: false, code}`. Then the runner MUST NOT: record anything in the journal,
change `exitCode`, `state`, `stage` or `message`, retry in a loop, print
output, or stop. The next scheduled write tries again. The writers open no file
other than the index, the status file and their own temporary file. They never
open `journal.jsonl`, `input.jsonl`, `attachments.jsonl`, artifacts or lock
files. A failed status write leaves the previous `status.json` whole. The only
visible effect of a failure is a missing or older derived file.

<details>
<summary><strong>Runs index — line, write and read rules</strong></summary>

One JSON object per line, UTF-8, newline at the end:

`{"v":1,"runId","workflow","repo":"owner/name","issue":{"number","url"},"agent","root":"<worktree>","runDir":"<gitDir>/pdd/workflows/<runId>","startedAt","pdd":{"node","bin","version"}}`

- `runId` is the lowercase UUID of the run. `agent` is `codex` or `claude`.
  `root` is the absolute assigned worktree. `startedAt` is ms since the epoch.
- `pdd`: `node` is the absolute Node executable, `bin` the absolute
  `bin/pdd.mjs` and `version` the package version of the pdd that started the
  run. Link needs it to type a resume line.
- **Write.** Create `~/.pdd/runs/` with mode 0700 when it is missing. Open the
  index with append and create, mode 0600, and write the whole line in one
  write call. A line over 4096 bytes is not written (`{ok: false, code:
  "too_large"}`). The writer never rewrites, sorts or compacts the file.
- **Read.** A missing file gives `{entries: [], dropped: 0}`. A line that is
  not JSON, is over 16 KB, has no UUID `runId`, or has a `runDir` that is not
  an absolute path ending in `/pdd/workflows/<runId>` (or the declared archive layout) is dropped and counted.
  A last line without a newline is ignored and not counted. Other fields are lenient: unknown fields are dropped;
  missing ones become `null`; any `v` is accepted.
- **Duplicates.** One entry per `runId`. The last valid line wins. Add optional `project:{id,name}` for name-based lists and `archived` and `archiveRunDir` for proved cleanup archives; never overwrite the original journal identity. A valid archived locator may end in `/runs/archive/<runId>` as well as the original runDir shape. Before cleanup, archival appends a new entry pointing to the retained archive. The last valid line wins. Entries keep
  the order of their first valid line.

</details>

## Status derivation

`runStatusFromState(state, extras)` builds the status from the journal state
alone plus `extras = {phase, now, outcome?, controller?}`. `phase` is `record`
(the controller wrote a record and goes on), `exit` (the controller returns
`outcome = {state, message, decisions?, what?}`) or `journal` (a reader that has only
the journal). `controller` is `{herdrSession, paneId}` with optional actual workspace/tab/terminal, PID/start identity, launch id and controller generation of the controller's own
Herdr pane, or `null` when it does not run in Herdr. The function is lenient:
a missing or wrong-typed state field gives `unknown`, `null` or `[]`, never an
exception. When `index` is not an integer ≥ 0 or `definitions` is not an
array, `state` is `unknown` for the `record` and `journal` phases, `stage` is
`null`, and `steps` and `resumeDecisions` are `[]`.

The current stage is `state.definitions[state.index]`. A stage is
**undecided optional** when it has `optional: true` and
`state.optional[<stage id>]` is absent.

| Field | Rule |
|---|---|
| `state` | `exit`: `outcome.state` (`completed`, `waiting`, `failed`, `recovery_required`; other text → `unknown`). `record`: `completed` when `index ≥ definitions.length`, else `running`. `journal`: `completed` when `index ≥ definitions.length`, else `unknown`, because the journal has no run state field (`state.name` is the workflow name). |
| `stage` | `{id, kind, index, total}` of the current stage; `index` counts from 0; `total` is `definitions.length`. `null` when there is no current stage. |
| `steps` | One item per definition, in order: `{id, kind, state, optional}`. Step state: a `completed[]` entry with that id and `skipped: true` → `skipped`; with that id otherwise → `done`; else the current stage → `failed` when the status state is `failed`, else `current`; a later stage → `next`; anything else → `unknown`. |
| `waitingFor` | Only when the status state is `waiting`, first match: quota-origin waitingPerson → its `continue|wait` decisions and current questionId/rev; otherwise: `outcome.decisions` given (items `approve` / `skip`) → those, what `outcome.what` or `null`; undecided optional → `["approve","skip"]`, what `Run or skip <id>`; stage kind `human` → `["approve"]`, what `Approve the current proposal and test plan`; stage kind `merge` → `[]`, what `Merge the PR on GitHub`; else `null`. States `running`, `completed`, `failed`, `recovery_required` → `{decisions: [], what: null}`. State `unknown` → `null`. |
| `resumeDecisions` | Decisions that `resume --decision` can apply by the saved state alone: undecided optional → `["approve","skip"]`; stage kind `human` → `["approve"]`; else `[]`. |
| `pr` | `{stage, number, url}` for each `completed[]` entry of kind `pr` with a PR number and URL, in order. |
| `stageAgent` | When `state.pending.kind` is `agent` or `cleanup` and it has a `backend`: `{kind: backend.agentKind ?? state.agent, nativeSessionId, herdrSession: backend.session, paneId: backend.paneId} (the current actual backend tool wins after a permitted handoff)`. `nativeSessionId` is `backend.nativeSession.value` when `backend.nativeSession.kind` is `id`, else `null`. Otherwise `null`. |
| `controller` | `extras.controller`, or `null`. |
| `message` | `exit`: `outcome.message`, cut to 300 characters. Else `null`. |
| `machineId`, `startId` | From the pinned journal placement/start identity; absent is null. Never derived from a process or current connection. |
| `controlState`, `rev`, `runtime` | Copy the journal's P1 fields. `runtime` is the saved frozen-runtime record. `rev` is the current human wait revision, not an extra status counter. Missing fields are null. Unknown controlState becomes `unknown` for display and permits no action. |
| `heartbeatAt`, `backendGen`, `quota`, `stall` | From the journal plus the lock holder's heartbeat observation; absent is null. Heartbeat every 15 s changes neither journalSeq nor rev. Quota carries renewal or unknown and continuation key, without credentials or message text. |
| `machineToolPolicy`, `actualAccount`, `accountTransition` | Copy the runner's machine/tool Settings observation, actual backend account and switch progress. A pending machine target never relabels the still-working backend. These are display observations, never an account selector or run preference. Missing is null; legacy selection fields are dropped with normal unknown-field warnings. |
| `project`, `launchSelection` | Saved project id/name and effective validated machine/tool model/effort selection, including its defaults/override source and CLI/catalog revision; missing is null. Paths remain internal locators. A later Settings default does not rewrite the run's frozen selection. |
| `effectiveSelection` | Current backend.launchSelection when present, otherwise the original saved launchSelection for the original tool. A cross-tool backend without its own selection yields null, never an original model relabeled for another tool. Derived observation only. |
| `runtimeNotice` | Optional journal-owned blocked-runtime advisory, including "Needs you: Upgrade run". Derived display never upgrades a run. Absent is null. |
| `waitingPerson` | Current `{rev,stage,inputRevision,artifactHashes,decisions,what}` plus quota `origin`/`questionId` from the journal; missing means null. Display only; decision commands recheck the journal. |
| other | `v: 1`, `runId`, `workflow: state.name`, `journalSeq: state.seq` (missing → `0`), `updatedAt: extras.now`. |

`what` texts are cut to 200 characters. The runner SHOULD pass
`outcome.decisions` for every wait that an explicit `--decision approve` can
end, for example a no-decision resume or a `next-advance` proposal.

<details>
<summary><strong>Status file — atomic write and lenient read</strong></summary>

- **Write.** Serialize the status as one JSON object plus a newline. Over
  256 KB → `{ok: false, code: "too_large"}`, nothing written. Create
  `<runDir>/.status.json.<16 hex from randomBytes>.tmp` exclusively, without
  following links, mode 0600. Write, fsync, then rename it to
  `<runDir>/status.json`. Fsync the directory when possible; a failed
  directory fsync after a good rename still returns `{ok: true}`. On any
  earlier failure, remove the temporary file when possible and return
  `{ok: false, code}`.
- **Read.** Missing file → `value: null`, warning `missing`. Over 256 KB →
  `null`, `too_large`. Not a JSON object → `null`, `bad_json`. `runId` not equal
  to the last name of `runDir` → `null`, `run_mismatch`. `journalSeq` not an
  integer ≥ 0 → `null`, `bad_record`. Else the value keeps the known fields of
  the table above. An unknown field is dropped with warning
  `unknown_field:<name>`. An unknown `state` or step state becomes `unknown`.
  A step without a string `id` is dropped with warning `dropped_item:steps`.
  A missing `waitingFor` means `null` (unknown).

</details>

<details>
<summary><strong>Journal and assignment readers (for runs without a status file)</strong></summary>

The [journal codec](workflow-journal.prompt.md) owns legacy full-state lines and
new snapshots/deltas. The runner owns authoritative full-history validation;
these display readers grant no execution authority. Both journal readers read `<runDir>/journal.jsonl` backwards from
the end in 1 MB chunks and never load the whole file. A **complete line** ends
with a newline. Bytes after the last newline are ignored with warning
`partial_line`.

- `readJournalLast` starts at the last complete line and collects its contiguous
  delta predecessors back to the nearest snapshot, then replays forward to return
  the complete latest state. A corrupt/unsupported delta or missing base yields
  `null`, `bad_record`; do not fall back to an older visible state. Retain the
  existing missing/too-large/bad-json/run-mismatch warnings. Legacy full-state
  lines retain their existing shape and behavior. This bounded snapshot tail is
  display evidence, not a substitute for the runner's full-history reader.
- `readJournalSince` walks complete lines backwards and collects
  `{seq, event, decisionId}` for each line with `seq > afterSeq`.
  `decisionId` is the line's top-level `decisionId` string, else `null`. It
  stops at the first line with `seq ≤ afterSeq` or at the file start
  (`complete: true`), or after 64 MB read (`complete: false`). A line that does
  not decode is skipped with warning `bad_json`. Records come out in rising
  `seq` order.
- `readAssignedRuns(commonDir)` reads each `*.json` file (≤ 64 KB) in
  `<commonDir>/pdd/worktree-assignments/issues/`. The
  [worktree assignment](workflow-worktree.prompt.md) prompt owns that schema.
  A file with `version` 1, a UUID `runId`, and absolute `gitDir` and
  `worktreePath` gives `{v: 1, runId, workflow: workflowName, repo: repository,
  issue: {number: issueNumber, url: null}, agent: null, root: worktreePath,
  runDir: <gitDir>/pdd/workflows/<runId>, startedAt: null, pdd: null}`. Any
  other file is dropped and counted. A missing folder gives no entries.

All readers only read. One bad line or file never hides the others.

</details>

<details>
<summary><strong>Unresolved points (provisional rules above)</strong></summary>

- A controller that is killed writes no exit status. Its file keeps the last `running` status; readers show `updatedAt` as an age.
- The index has no compaction. Archives append locators; malformed or torn derived lines never authorize deletion or recovery.

</details>

## Dependencies

- [Journal codec](workflow-journal.prompt.md): required generation/runtime/verification context for snapshot and delta replay.

| Input | Role | Uses |
|---|---|---|
| [Prompting guide](../../docs/prompting-guide.md) | Authoring method | Authoring |
| [Story](../../story/cli/WORKFLOW-RUN-RECORDS.md) and [cases](../../vectors/cli/workflow-run-records.json) | Expected outcomes, not observed results | Verification |
| Caller-supplied `{seq,event,state}` and declared V1/P1 fields above | Required runtime/verification input. The journal is authoritative; this module never reads its own status as runner input | Runtime, verification |
| [Worktree assignment](workflow-worktree.prompt.md) | Owner of the assignment file schema read by `readAssignedRuns` | Generation, verification |
| [Frozen runtime](workflow-runtime.prompt.md) | P1 runtime field meanings | Generation, verification |

Runtime: Node 22 built-ins only, through the supplied `fs`, `home` and
`randomBytes` ports. [Link runs](../phone/link/runs.prompt.md) is the main
reader (navigation only).
