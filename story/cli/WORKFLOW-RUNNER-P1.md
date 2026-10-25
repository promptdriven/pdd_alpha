# Story: runner p1

Draft for review. As a person using PDD, I want to keep my run, work and approval intact through updates, crashes and account continuation.
The [owning prompt](../../prompts/cli/workflow-runner.prompt.md) defines behavior.
These synthetic observations are independent expected cases, not execution results.

## Observable acceptance criteria

- **AC1:** Prepare no agent: assignmentAndFreezeDurable = true; stagePrompts = 0; state = "prepared".
- **AC2:** Frozen resume: usesRecordedRuntime = true; usesFrozenGuide = true; decisionMayProceed = true.
- **AC3:** Stale rev: code = "stale_decision"; effects = 0.
- **AC4:** Changed accepted file: accepted = false; effects = 0.
- **AC5:** Human exit: controlState = "waiting_person"; controllerLockHeld = false; exitCode = 2.
- **AC6:** Stall alarm only: needsYou = true; failed = false; killed = false; resent = false.
- **AC7:** Sleep not stall: stageFailed = false; alarmFromSleep = false.
- **AC8:** Controller resume live: reattach = true; newStagePromptCount = 0; backendGenChange = 0.
- **AC9:** New process generation: backendGenChange = 1; sameAttempt = true; firstPromptRepeated = false.
- **AC10:** Lost dialog: controlState = "question_lost"; savedKeysSent = 0.
- **AC11:** Cross tool contract: newChat = true; sameAttempt = true; includes = ["full frozen guide", "stage instructions", "accepted files", "handoff schema", "completed effects", "uncertain effects", "changes from stage input"]; blindEffectRepeat = false.
- **AC12:** Uncertain send: needsYou = true; resends = 0.
- **AC13:** Adopt only: adoptionRecorded = true; journalBytesPreserved = true; prompts = 0; controllerStarts = 0; approvalInvented = false.
- **AC14:** Adopt incomplete: state = "recovery_required"; newAttempt = false.
- **AC15:** Cleanup stage pane: closed = ["stage pane"]; workspaceClosed = false; runTabClosed = false.
- **AC16:** Fetch before allocation: worktreeAdds = 0; staleLocalBaseUsed = false.
- **AC17:** Publication advisory: warningInPR = "redacted"; needsYou = true; publicationBlockedByScan = false.

[Expected cases](../../vectors/cli/workflow-runner-p1.json). Case keys express observations;
they do not invent a product wire format. No implementation or live test ran.


## Review edge cases

- **AC18:** Remote preallocated id: sourceWorktreeCreated = false; targetRunId = "same saved UUID"; targetPrepareRunId = "same saved UUID".
- **AC19:** Display index failure recovery: runFailureFromIndex = false; keeperFindsRun = true.
- **AC20:** Native history resume no first prompt: historyOnlyResume = true; newGeneration = true; originalRequestResent = false.
- **AC21:** Native history unproved: newFirstPrompt = false; recoveryContinuation = false; needsYou = true.


## Locked plan observations

- **AC22:** Wait locked retry intervals: retryDelaysMinutes = [5, 15, 60, 60]; continuations = 0.
- **AC23:** Wait renewal unknown: display = "renewal time unknown"; continuationSentWithoutRoomProof = false.
- **AC24:** Codex rollout usage optional: selectionMayProceed = true; requiresRolloutUsage = false.
- **AC25:** A machine/tool account transition is shared by all managed agents; this backend retains its actual account until its current step reaches a proved safe boundary.


## Review fix acceptance

- **AC26:** A current continue answer to a quota question records admission but sends no continuation itself.
- **AC27:** A current wait answer belongs only to the matching quota question and sends no message.
- **AC28:** A continue answer cannot approve an ordinary workflow human stage.
- **AC29:** An old or mismatched quota question is refused even when a run is waiting.
- **AC30:** A cross-tool handoff adds the target tool to the attempt/turn key and binds its generation.


## Round 2 acceptance

- **AC31:** Auto advances one shared machine/tool target, with each active agent switching only at its own safe step boundary; concurrent quota reports cannot rotate twice.
- **AC32:** An exhausted fixed account pauses for Use Auto, Pick another account or Wait until the renewal; any change targets machine/tool Settings and stale policy/question revisions change nothing.
- **AC33:** Two machines can use one account and observe shared usage; Auto alone never grants cross-tool permission.
- **AC34:** A workflow inherits target-tool model/effort defaults or validates a start override, freezes the pair, and blocks unsupported recovery rather than substituting.
- **AC35:** Every launch/handoff preserves completed Stories, prompts, independent cases, guide-first frozen context and actual tests; an unfinished required specification cannot become a build stage.
- **AC36:** No per-agent/run account preferences are accepted or restored from legacy journal fields.

- **AC37:** Public managed resume returns prepared after validating the original run and current decision; it leaves journal bytes unchanged and starts no native stage, cleanup or publication. Only the pane controller records and consumes the decision.

- **AC38:** Public attachment supplies actual stage transport/process and assignment/attempt/generation-bound durable claim ports. Saved and newly discovered native IDs attach only after ownership is proved; missing/busy/uncertain claims or failed checkpoint never spawn attachment or a replacement.
- **AC39:** Attachment under a live controller remains read-only and can reuse its same already-owned claim. It cannot race journal sequences, persist newly discovered identity or bind a different owner. The shared guard and fsynced epoch still invalidate old candidates without stopping live controller polling.
