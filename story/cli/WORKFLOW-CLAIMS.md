# Story: claims

Draft for review. As a person using PDD, I want to restore a managed session once, including when a replacement has a different native id.
The [owning prompt](../../prompts/cli/workflow-claims.prompt.md) defines behavior.
These synthetic observations are independent expected cases, not execution results.

## Observable acceptance criteria

- **AC1:** Held across exec: secondState = "busy"; secondExecs = 0; firstUnaffected = true.
- **AC2:** Process exit: kernelLock = "free"; lockUnlinked = false.
- **AC3:** Pid reuse: exclusionSource = "kernel lock"; killProcesses = false.
- **AC4:** Unknown lock: state = "uncertain"; nativeExecs = 0.
- **AC5:** Provisional id: provisionalHeld = true; nativeIdInvented = false.
- **AC6:** Late restore retired: oldStart = "retired"; oldExecs = 0; workingGenerations = 1.
- **AC7:** Successor not stopped: successorMayWork = false.
- **AC8:** Same live reattach: newNativeProcess = false; backendGenIncrement = 0.

[Expected cases](../../vectors/cli/workflow-claims.json). Case keys express observations;
they do not invent a product wire format. No implementation or live test ran.


## Review edge cases

- **AC9:** Provisional promotion atomic: nativeAcquiredBeforeProvisionalRelease = true; bindingDurableBeforePrompt = true.
- **AC10:** Provisional promotion busy: provisionalRetained = true; prompts = 0.


## Round 2 acceptance

- **AC11:** A machine-wide account change preserves one working generation per agent, with old generation stopped and retired before a successor works.
