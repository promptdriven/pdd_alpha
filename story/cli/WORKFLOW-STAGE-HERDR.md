# Story: background stages that run once and report honestly

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who runs `pdd workflow run` or `pdd workflow resume`, I want each agent stage to run as a fresh native agent in a background Herdr server that my run owns. Each stage must get exactly one prompt and an honest status. Then PDD never resends work, never touches my other Herdr sessions or native settings, and never treats an idle agent as success.

The [owning prompt](../../prompts/cli/workflow-stage-herdr.prompt.md) holds the rules. This Story makes them observable. Preserve the four module functions `runHerdrStage`, `inspectHerdrStage`, `attachHerdrStage` and `closeHerdrStage`, their result shapes, backend fields, phase names, Herdr argv and reason codes.

Out of scope: the runner's journal, handoff validation, test runs, acceptance decision and attachment epoch (see the [workflow runner](../../prompts/cli/workflow-runner.prompt.md)); `pdd session`; Herdr's own behavior; any claim about how many stages can run at once on one computer.

## Observable acceptance criteria

- **AC1 Fresh stage.** With no saved backend and a stopped target, `runHerdrStage` bootstraps the server named by the server-name rule, creates one no-focus workspace and starts the agent with the full-access argv for its kind. It sends exactly one prompt with the exact text that the one-prompt rule defines. It returns `settled`, phase `candidate`, and evidence with `readySeq` < `workingSeq` < `settledSeq`. The checkpoints show the phases in the order of the phase table, each before its effect.
- **AC2 Owned server only.** A running target without a recorded fingerprint, an incompatible target, a changed fingerprint, or a workspace list that is not the seed list returns `recovery_required` before any workspace, start or prompt effect. No server is stopped or restarted. An empty workspace list is allowed.
- **AC3 Checkpoint fencing.** When a checkpoint fails, the effect that follows it does not happen. A failure at the first `server_intent` checkpoint runs no Herdr command. A failure at `prompt_intent` sends no prompt.
- **AC4 One prompt, honest liveness.** A lost prompt reply, ready without observed work, an unknown state, a timeout, a changed identity or native session, a vanished agent or a reversed sequence returns `recovery_required`. Calling again with the same original never sends a second prompt, starts another agent or creates another workspace. Nothing is closed.
- **AC5 Startup that needs a person.** It returns `blocked` with reason `native_start_person_action_required`, phase `start_intent`, attach guidance in `detail` and zero prompts. The reported native session and sequence are saved. After the person finishes startup, the same original sends its first prompt without a second start. A changed native session refuses.
- **AC6 Pre-native recovery.** A same-original backend that is pre-native bootstraps again with the same IDs and digest and sends one prompt. A legacy long server name moves to the short name only when the legacy server is stopped. A backend with any extra field, or a later phase, stays inspection only.
- **AC7 Read-only inspection.** `inspectHerdrStage` runs only status and agent lookups and never checkpoints. Phases `closed` and `close_intent` return without any Herdr command.
- **AC8 Stage guard.** Without a guard, every function refuses before any checkpoint, server, workspace, start, prompt, attach or close effect. Attach holds the guard until detach. Guard contention during observation waits without a second prompt and without using the first-activity window. Contention that does not end returns `stage_wait_timeout`.
- **AC9 Attach.** For a verified active stage, attach spawns `herdr --session <session> agent attach <agentName>` in the worktree with inherited stdio and returns that exit code. A closed stage returns 2 with no effect. A refusal returns 1.
- **AC10 Cleanup.** Only a candidate with a matching acceptance and an unchanged settled sequence is closed. `close_intent` is checkpointed before the close, and only the stage workspace is closed. An unconfirmed acknowledgement or readback keeps `close_intent` and returns `recovery_required`, with exactly one close command and no prompt.
- **AC11 Next stage.** A closed and accepted previous backend donates its running server. The next stage gets no bootstrap, a new workspace, a new agent name and native session, and one prompt.
- **AC12 Structured errors.** A failing Herdr command keeps its JSON error code, its operation and a message of at most 600 characters in `detail`. No Node failure message, prompt text, raw output or environment value appears. A prompt failure keeps no message.

## Cases and evidence

The [expected cases](../../vectors/cli/workflow-stage-herdr.json) map inputs to these criteria. Their expected values come from the prompt, not from running the module.

Existing tests are evidence for the criteria. This Story does not claim that they ran.

| Criteria | Tests in `test/workflow-stage-herdr.test.mjs` unless named |
| --- | --- |
| AC1 | "fresh owned stage checkpoints actual IDs ...", "actual default spawn boundary uses headless short-name server ...", "fresh stages trust only the assigned worktree ...", "two concurrent issue assignments ..." |
| AC2 | "checkpoint failure fences corresponding effect; incompatible or unowned server ...", "pre-native recovery refuses changed input/server ..." |
| AC3 | "checkpoint failure fences corresponding effect ...", "... launch snapshot pins supplied native session ..." |
| AC4 | "reply loss retains original prompt intent ...", "idle, blocked, unknown and identity loss ...", "native disappearing before submit ...", "... launch snapshot pins ...", "captured candidate cannot absorb later activity ..." |
| AC5 | "owned native startup choice is actionable ...", "a launch success snapshot cannot authorize prompt ...", "... blocked lookup retains actual native session ..."; in `test/workflow-runner.test.mjs`: "main joins frozen native adapter ..." |
| AC6 | "proven pre-native server/list failure ...", "pre-native recovery refuses changed input/server ...", "legacy stopped pre-native original migrates short ..." |
| AC7 | "reply loss retains original prompt intent ...", "captured candidate cannot absorb later activity ...", "proven pre-native server/list failure ..." |
| AC8 | "missing guard refuses before provision ...", "ordinary viewer guard contention waits ...", "persistent viewer contention remains bounded ..." |
| AC9 | "missing native session identity stays null; active attach uses exact target ...", "actual default spawn boundary ..." |
| AC10 | "fresh owned stage checkpoints actual IDs ...", "cleanup refuses replacement, activity, or later sequence ...", "... cleanup malformed/unrelated acknowledgements ..." |
| AC11 | "accepted predecessor reuses only owned run server ..."; in `test/workflow-runner.test.mjs`: "main joins frozen native adapter ..." |
| AC12 | "proven pre-native server/list failure preserves structured error ..." |

No existing test checks that a failed `agent prompt` keeps no message, or that an empty workspace list is allowed. Passing these finite cases is evidence, not proof over all Herdr replies or timings.

## Open questions

1. The runner sends only `start_intent` and `ready` back to `runHerdrStage`. It inspects `server_intent`. So pre-native recovery and the legacy rename have no product caller today. The runner's checkpoint port also refuses a changed `session` or `server`, which the legacy rename needs. Should the runner route pre-native recovery, or should this module drop it?
2. `attachHerdrStage` itself refuses only phase `closed`. For `close_intent`, it relies on the runner, which refuses to attach a stage in cleanup. Is that split accepted?
3. Settlement needs an observed `working` state. An agent that finishes before the first poll, with a prompt reply that does not show `working`, ends in `prompt_activity_stalled`. Is that accepted as the honest result?
