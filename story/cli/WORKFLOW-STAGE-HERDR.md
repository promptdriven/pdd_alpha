# Story: workflow stage herdr

Draft for review. I want to keep one exact native stage safe through start, attach and cleanup.
[Owning prompt](../../prompts/cli/workflow-stage-herdr.prompt.md).

## Observable acceptance criteria

- **AC1:** Actual start ack pinned: state = "recovery_required"; prompts = 0.
- **AC2:** Ack checkpoint fails: liveLookups = 0; prompts = 0.
- **AC3:** Same ready first prompt: prompts = 1; newStarts = 0.
- **AC4:** Prompt intent not resend: prompts = 0; replacementStarts = 0.
- **AC5:** Blocked startup: state = "blocked"; nativeIdPreserved = true; autoanswered = false.
- **AC6:** Candidate requires activity: settled = false; accepted = false.
- **AC7:** Candidate is not pass: transport = "settled"; runnerMustValidateHandoffAndTests = true.
- **AC8:** Attach invalidates candidate: oldCandidateAccepted = false; freshSameAttemptInspection = true; promptResent = false.
- **AC9:** Guard busy poll: state = "active"; outOfGuardQueries = 0; newAttempts = 0.
- **AC10:** Close own pane: closed = ["stage pane"]; workspaceCloseCalls = 0.
- **AC11:** Close reply lost: state = "recovery_required"; repeatClose = false; nextStageStarted = false.
- **AC12:** Native id null: nativeId = null; fabricatedId = false.
- **AC13:** Legacy backend: newPrompts = 0; serverRestart = false; workspaceClose = false.
- **AC14:** Stage no hard timeout: failedForDuration = false; terminated = false.

[Expected cases](../../vectors/cli/workflow-stage-herdr.json) are synthetic independent expectations, not execution results.


## Locked plan observations

- **AC15:** Idle without process proof: ready = false; prompts = 0.
- **AC16:** Process without stage generation: ready = false; prompts = 0.
- **AC17:** Failed claude resume needs you: needsYou = true; resumeRetried = false; handoffRequiresSeparateIntent = true.


## Round 2 acceptance

- **AC18:** A validated target-machine model/effort pair is checkpointed and passed unchanged to the canonical native argument owner.
- **AC19:** Unsupported saved model/effort blocks recovery without a new model or prompt.
- **AC20:** Restore reconciles the current machine/tool policy and shared account transition; old account observations never override Settings.

- **AC21:** A native id first returned by prompt acknowledgement or later observation is durably recorded and claimed before further stage progression or settlement.
- **AC22:** Busy, retired, uncertain or unacknowledged promotion preserves original prompt and native identity without settlement, resend, replacement or cleanup; later same-owner reconciliation may proceed.
- **AC23:** Failed or missing discovery checkpoint prevents promotion and settlement, including inspection; inspection cannot deliver another prompt.
