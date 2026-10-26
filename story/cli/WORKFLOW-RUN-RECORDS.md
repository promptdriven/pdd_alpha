# Story: workflow run records

Draft for review; examples are synthetic.

## Request and scope

As a person who follows local PDD workflow runs from the phone, I want pdd to
leave a small runs index and a short status file for each run, so that PDD
Link can find every run on the machine and show what it waits for without
parsing the private journal. A failed write of these files must never change
the run. The [owning prompt](../../prompts/cli/workflow-run-records.prompt.md)
defines the contract.

Out of scope: the journal format and stage progression (the workflow runner),
the assignment schema (the worktree helper), the `pdd workflow decide`
command, and everything Link does with the records.

## Observable acceptance criteria

- **AC1:** `appendRunIndex` appends exactly one newline-terminated line with
  the index fields, including `pdd: {node, bin, version}`. It creates
  `~/.pdd/runs/` (0700) and the file (0600) when missing. A line over 4096
  bytes is not written and gives `{ok: false, code: "too_large"}`.
- **AC2:** `readRunIndex` returns one entry per `runId`; the last valid line
  wins and the first valid line sets the order. Bad lines are dropped and
  counted. A last line without a newline is ignored and not counted. A missing
  file gives no entries.
- **AC3:** `runStatusFromState` sets `state` by phase: `exit` uses the
  outcome; `record` gives `running` or `completed`; `journal` gives `unknown`
  or `completed`.
- **AC4:** Steps follow the definitions in order with `done`, `skipped`,
  `current`, `failed`, `next`; `stage.index` counts from 0.
- **AC5:** `waitingFor` and `resumeDecisions` follow the derivation table,
  including supplied `outcome.decisions`, undecided optional stages, human
  stages and merge waits.
- **AC6:** `pr`, `stageAgent`, `controller`, `message` (cut to 300
  characters), `journalSeq` and `updatedAt` follow the table.
- **AC7:** `runStatusFromState` never throws; wrong-typed input gives
  `unknown`, `null` or `[]`.
- **AC8:** `writeRunStatus` replaces `status.json` through an exclusive
  temporary file and a rename. On failure it returns `{ok: false, code}`,
  leaves the previous file whole, and opens no other run file. It never
  throws.
- **AC9:** When a status or index write fails, the runner's returned
  `exitCode`, `state`, `stage` and `message` and the journal bytes are the same
  as with a working write.
- **AC10:** `readRunStatus` is lenient: unknown fields are dropped with a
  warning, unknown enum values become `unknown`, and missing, oversized,
  non-JSON or mismatched files give `value: null` with the stated warning.
- **AC11:** `readJournalLast` returns only the last complete line, ignores a
  trailing partial line, and never falls back to an older line.
- **AC12:** `readJournalSince` returns `{seq, event, decisionId}` for lines
  with `seq > afterSeq` in rising order and says whether the read was
  complete.
- **AC13:** `readAssignedRuns` maps valid assignment files to index-shaped
  entries and drops invalid ones.

The independent [expected cases](../../vectors/cli/workflow-run-records.json)
map stand-in files and inputs to these criteria. Expected values come from the
contract, not from running code.


## P1 additions

- **AC14:** Status adds runtime, human wait rev, heartbeat, generation, actual account, machine/tool policy revision, project, frozen model/effort, placement and quota/alarm observations; absent values stay null and heartbeats change no journal seq or rev.
- **AC15:** Unknown control state is shown as unknown and authorizes no action.
- **AC16:** A proved archive locator retains the run history after safe cleanup;
  the index remains a locator, never permission to delete or resume.


## Locked plan observations

- **AC17:** Status distinguishes the current backend account from a pending shared machine/tool target, without applying policy or offering a run account selector.
- **AC18:** Blocked runtime notice: runtimeNotice = "Needs you: Upgrade run"; updaterWritesRunJournal = false.


## Review fix acceptance

- **AC19:** A waiting quota question retains its continue/wait domain, question id and current revision in the view.


## Round 2 acceptance

- **AC20:** Project names and frozen effective model/effort appear in derived views; later Settings edits cannot rewrite them.
- **AC21:** Legacy run account-choice fields are ignored as unknown display fields; status remains read-only.

- **AC22:** After a cross-tool handoff, the original frozen selection stays intact while effectiveSelection shows the actual successor’s model/effort; an unknown successor pair stays null.
