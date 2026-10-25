# Story: runtime

Draft for review. As a person using PDD, I want to continue an old run after updates with the same accepted instructions and recorded runtime.
The [owning prompt](../../prompts/cli/workflow-runtime.prompt.md) defines behavior.
These synthetic observations are independent expected cases, not execution results.

## Observable acceptance criteria

- **AC1:** Freeze full context: frozen = "actual bytes and hashes"; beforeFirstPrompt = true; credentialsSaved = false.
- **AC2:** Source changed: resumeInput = "saved freeze"; refusedForOriginalEdit = false.
- **AC3:** Freeze changed: ok = false; code = "frozen_input_invalid"; launches = 0.
- **AC4:** Node missing: ok = false; code = "runtime_missing"; fallbackToCurrent = false.
- **AC5:** Partial freeze: launches = 0; overwriteFreeze = false.
- **AC6:** Multi release run: keepOldRuntime = true; unknownFieldsPreserved = true.
- **AC7:** Upgrade not consent: runVersionChanged = false; waitRev = 57.
- **AC8:** Stock tool change: stockToolPinnedByPDD = false; compatibilityCheckRequired = true.

[Expected cases](../../vectors/cli/workflow-runtime.json). Case keys express observations;
they do not invent a product wire format. No implementation or live test ran.


## Review edge cases

- **AC9:** Freeze seed complete: seedBytesFrozen = true; undeclaredLookup = false.


## Locked plan observations

- **AC10:** Raw unknown control preserved: rawControlStateAfterRewrite = "future-state"; effectsAuthorized = false.
- **AC11:** Blocked pinned run: notice = "Needs you: Upgrade run"; automaticRunUpgrade = false; runtimeDeleted = false; stageKilled = false.


## Review fix acceptance

- **AC12:** A current, confirmed stopped-boundary upgrade records old/new runtime identities before committing and starts no agent.
- **AC13:** A stale upgrade revision leaves the runtime and journal unchanged.
- **AC14:** A live turn or unresolved effect prevents an upgrade.
- **AC15:** An interrupted intent without a durable commit retains the old runtime.
- **AC16:** A durable commit selects the new runtime even if the derived status update was interrupted.
- **AC17:** Repeating an identical committed request returns its prior result before stale checks.
- **AC18:** A pending upgrade cannot be replaced by a different target using the same wait revision.


## Round 2 acceptance

- **AC19:** The resolved project identity/name and validated model/effort pair are frozen launch inputs; later Settings edits do not change them and no account choice is frozen.
