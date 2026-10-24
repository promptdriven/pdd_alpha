# Story: take a GitHub issue through checked stages without repeating uncertain work

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who runs `pdd workflow run NAME ISSUE`, I want PDD to take that issue through its workflow in a separate worktree, one fresh agent per stage, so that my own checkout stays untouched and each stage is checked before the next one starts. When the run stops, I want `pdd workflow resume RUN_ID` and `pdd workflow attach RUN_ID` to continue or show that same run, so that a crash, a lost reply or my own interaction never makes PDD start a second agent, push twice or open a second PR. Only my explicit approval may retry a PR whose original never reached GitHub.

The [owning prompt](../../prompts/cli/workflow-runner.prompt.md) holds the rules. This Story makes them observable. It preserves the module functions `runWorkflow`, `resumeWorkflow` and `attachWorkflow`, the re-exported constant `WORKFLOW_STAGES`, the result shape and exit mapping, the saved-state locations, the decision rules and every forbidden effect.

Out of scope: argument parsing and help, the handoff schema and file hashing, worktree allocation, GitHub reads and writes, Herdr transport, native launch flags and the bundled stage content. Their own prompts own them; this Story checks only the runner's use of them.

## Observable acceptance criteria

- **AC1:** Every call resolves, never rejects, with `{exitCode, state, runId, stage, message}`. `completed` gives exit code 0, `waiting` gives 2, `failed` and `recovery_required` give 1. `runId` is `null` when input checks fail, before a new run ID exists, or when the saved journal cannot be read. `stage` is `null` after completion. `message` is one nonempty line.
- **AC2:** An invalid `agent`, `runId` or `decision` (also `decision: null`), or a missing `packageRoot` or `loadGuidance` port, refuses with `failed` (`recovery_required` for attach) and `runId: null`. Nothing is saved, no worktree is allocated and no agent, Git push or GitHub write happens.
- **AC3:** A new run saves its snapshot (definition, Markdown and full guidance) before the worktree helper allocates. Every agent stage, test and PR uses the assigned worktree. The source checkout's files and Git status stay unchanged, also when dirty. Mandatory stages run until the first stage that needs a person.
- **AC4:** A second `run` for an issue that already has a run, with any workflow name or agent, returns the original run ID and stage (`waiting`, or `recovery_required` with pending work). It starts no agent, allocates no worktree and keeps the saved agent. While the original controller is live, the result is `failed` with the original run ID.
- **AC5:** A resume without a decision starts no agent stage, test run, push or PR create. It may inspect a saved attempt, reconcile a saved PR and observe a merge, and it stops after a merge observation.
- **AC6:** Decisions follow the prompt's [decision table](../../prompts/cli/workflow-runner.prompt.md#decision-table). `skip` at a stage that is not optional gives `failed` with no effect. A saved skip survives an interruption, and a later `approve` neither runs the skipped stage nor publishes its PR; the matching merge stage is skipped too. A saved `approve` cannot become a skip. A human stage waits until `approve`. A `next-advance` proposal waits for an `approve` in a later command.
- **AC7:** An uncertain agent delivery, cleanup or PR outcome is never repeated: no second transport start, no second prompt, no second close, no second push or PR create (except the approved attempt in AC13). Only an attempt whose first prompt was not sent continues on `approve`, with the same attempt ID and identical request bytes. Changed request bytes or a changed worktree refuse before any transport call.
- **AC8:** A stage is accepted only with a valid handoff, unchanged pinned files, unchanged current input and, for a verify stage, passing pinned tests that changed neither the worktree nor the handoff. Otherwise the result is `failed` or `recovery_required`, with no cleanup. A native exit code 0 or agent prose alone never completes a stage. A manual worktree change after the saved input refuses.
- **AC9:** A verified PR needs successful pinned tests bound to the exact current input; a later change refuses before any push. A merge stage advances only when the saved original PR number and URL are merged. A different PR gives `recovery_required`, a closed unmerged PR gives `failed`, and an open PR gives `waiting`. The runner never merges.
- **AC10:** After a prompt PR merges, a changed worktree is adopted as input only by `approve` with no pending work, a clean worktree, unchanged pinned files and the merge commit in HEAD's history. Without the merge commit the next stage waits. The runner never checks out, resets or rebases.
- **AC11:** Attach connects only the saved active stage agent and starts no conversation. While attached, the controller cannot accept that stage. A candidate captured before the attachment is dropped (`waiting`), and a later `approve` validates the same attempt afresh without a new agent. With no live stage, attach gives `waiting` and calls no native attach.
- **AC12:** A torn, aliased or tampered journal or snapshot, or an edited recipe, guide or overview, gives `failed` with no replacement work. A second live command for the same run gives `failed`. An unknown run ID gives `recovery_required` and creates nothing. Distinct issues run independently, and the runner creates no repository admission state.
- **AC13:** When a pending PR is not proved by reconciliation, a resume with `approve` makes at most one new publication of the same saved intent, and only when GitHub shows no original PR and no saved remote head branch. A `pr.unpublished_retry_intent` journal row is appended before any push, and the saved intent is unchanged. A proved PR is recorded with `waiting`. An existing PR or remote head, a failed read or a lost reply gives `recovery_required` with no further push or create. A resume without a decision, or with `skip`, only reconciles. Each further attempt needs a new `approve`. No agent stage is started again.
- **AC14:** A valid journal resumes from its last row at any size, also when it is larger than the longest string Node can hold, and all its earlier bytes stay unchanged. Every earlier row is checked too: malformed JSON, a sequence gap or another run ID in any row gives `failed` like a torn last line (AC12), with no agent stage and no rewrite. Whitespace-only lines after the last row are accepted.

## Cases and evidence

The independent [expected cases](../../vectors/cli/workflow-runner.json) map inputs and starting states to these criteria. They were written from the prompt, not from running the module.

Existing tests are evidence for the criteria. This Story does not claim that they ran.

- [`test/workflow-runner.test.mjs`](../../test/workflow-runner.test.mjs):
  - AC1, AC3, AC5: the small-change run test (exit codes 2 and 0, inspection launches nothing), and the editable renamed workflow test (snapshot before allocation, dirty source checkout unchanged).
  - AC4: the duplicate same-issue test, the live original controller test and the aliased issue claim test.
  - AC6: the feature optional skips test, the mandatory skip test, the saved optional skip interruption test and the stale optional snapshot test.
  - AC7: the native nonzero, missing or stale handoff, lost PR reply, cleanup ambiguity and first-dispatch tests (continuation, phase selector, changed request or worktree).
  - AC8: the wrong implementation, rewritten expectations, changed test argv, empty work handoff, mutating check, rewritten handoff, changed source and whitespace filename tests.
  - AC9: the verified publication after a later report test, the replacement PR test and the separate prompt PR test.
  - AC10: the separate prompt PR ancestry test and the uncertain build transition test.
  - AC11: the cross-process attachment test.
  - AC12: the torn journal, substituted identity, redirected directory, multiply linked journal, unknown resume ID, changed recipe, changed guide, preallocation input variants, concurrent command, controller lock, fresh-process resume, five distinct issues and old admission files tests.
  - AC13: the pre-authentication push failure test, the present remote head and unreadable query test and the lost reply during unpublished PR recovery test.
  - AC14: the journal beyond the Node string limit test, the streamed journal history test (sequence, run, malformed and partial variants) and the split UTF-8 and trailing whitespace test.
- [`test/cli.test.mjs`](../../test/cli.test.mjs) and [`test/cli-editable-routing.test.mjs`](../../test/cli-editable-routing.test.mjs): stand-in runners cover how the CLI uses the AC1 result shape and exit codes.

No existing runner test directly covers AC2 at the module level (the parser tests refuse those words first), a closed unmerged PR, a saved `approve` followed by `skip`, attach with no live stage, or `skip` on a pending PR. Several tests match message text, which the prompt leaves free. Passing these finite cases is evidence, not proof over all stage orders, interruptions and timings.

## Open questions

- After the runner reconciles pending work, the same `approve` can also choose the next optional stage or accept the next human stage in one command. The next-advance proposal has a guard against this; human and optional stages do not. Is this intended, or should reconciliation use up the decision?
- A duplicate `run` for an issue saves a snapshot for its new run ID before allocation refuses it, and nothing deletes that snapshot. Is the leftover file accepted?
- Should the tests check states and effects instead of message fragments, since the prompt does not fix message wording?
