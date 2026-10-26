# Story: keeper

Draft for review. As a person using PDD, I want to recover a stopped controller without repeating a prompt or answering a human wait.
The [owning prompt](../../prompts/cli/workflow-keeper.prompt.md) defines behavior.
These synthetic observations are independent expected cases, not execution results.

## Observable acceptance criteria

- **AC1:** Restart after death: driveLaunches = 1; requiresProcessProof = true; stageFirstPromptsRepeated = 0.
- **AC2:** Human wait: driveLaunches = 0; decisionCreated = false.
- **AC3:** Question lost: driveLaunches = 0; keysSent = 0.
- **AC4:** One free check: driveLaunches = 0.
- **AC5:** Budget boundary: driveLaunches = 0; needsYou = true.
- **AC6:** Uncertain launch: inspectOriginal = true; driveLaunches = 0.
- **AC7:** Quota observation: state = "WAIT"; continuations = 0; retryObservation = true.
- **AC8:** Alpha only: recoveryUsesPrivateCode = false; driveLaunches = 1.
- **AC9:** Legacy unadopted: driveLaunches = 0.
- **AC10:** Unstable herdr: driveLaunches = 0.

[Expected cases](../../vectors/cli/workflow-keeper.json). Case keys express observations;
they do not invent a product wire format. No implementation or live test ran.


## Locked plan observations

- **AC11:** Public runs keeper service: runsAtBootOrLogin = true; privateDependency = false; reconcileIntervalSeconds = 30.
- **AC12:** Service owner contention: secondOwnerLaunches = 0; secondOwnerResult = "busy".
- **AC13:** Nonmanaged command pass through: stockInvocationUnchanged = true; stockSignInUnchanged = true; claimOrSwitchApplied = false.
- **AC14:** Managed restore: restoreRefused = true; stockSignInUnchanged = true.


## Round 2 acceptance

- **AC15:** Recovery rechecks the shared machine/tool account transition and never restores an old per-run preference.
- **AC16:** A fixed-account quota question stays stopped until the person chooses a machine/tool Settings action or waits.
