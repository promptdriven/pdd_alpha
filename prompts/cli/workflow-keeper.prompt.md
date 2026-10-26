# Local controller recovery

Own `src/workflow-keeper.mjs`. Draft for review. The module function
`reconcileWorkflowControllers({entries, now}, ports)` checks known local runs
and returns per-run `{runId, state, code}`. It never accepts a stage, answers a
question or selects an account. Preservation: new public recovery contract;
retain saved attempts and never turn restart into renewed human authority.

The boot/login owner enumerates `~/.pdd/runs/registry/*.json` and the display
index, union by runId, every 30 s. `entries` is that union. Validate each locator
against its actual common-directory assignment; never trust index/registry as
state. A failed display index append cannot hide a registered run. Corrupt or
missing registry files produce warnings and no speculative repo scan or launch.
Run every 30 seconds. Read and validate the journal before any launch; index and
status are locators/views only. Eligible durable states are `running`,
`waiting_agent`, `quota_wait`, and due quota `WAIT`. Never restart
`waiting_person`, `question_lost`, completed, failed, damaged, unknown or
unadopted legacy runs. A blocked agent question is a human wait, even if a
stale view says running. WAIT checking is observation only, not another send.

```mermaid
flowchart TD
    E{Eligible saved state?} -->|No| K([Keep stopped])
    E -->|Yes| H{Herdr and restore settled?}
    H -->|No| K
    H -->|Yes| L{Controller lock free twice?}
    L -->|No or unknown| K
    L -->|Yes| B{Launch budget and runtime valid?}
    B -->|No| N([Needs you])
    B -->|Yes| S[Launch recorded drive and require process proof]
```

**Restore settled:** Herdr has been up at least 30 s and a complete agent list
has been stable at least 5 s. Check the controller lock free on two checks at
least 30 s apart. A fresh locked recheck immediately precedes launch admission;
concurrent keepers cannot both create a launch intent. Persist launch admissions
and allow fewer than 3 in the preceding hour. Exactly 3 suppresses the next
launch. If uncertainty remains from an earlier launch, reconcile its exact
process/journal first; it consumes admission and cannot cause another blind start.
When observations are available, recover a killed controller within 90 s.
Unknown Herdr state never proves an agent or controller stopped.

Inside its lifetime lock, the public keeper fills missing runner authority and
locator bindings through `createLocalWorkflowControllerPorts(ports)` before
scheduling reconciliation. The same factory obtains missing real Herdr,
shared `processStartIdentity` and complete/stable inventory bindings from their
public owner. It creates no pane and grants no launch authority by itself.
Explicit test/owner ports win.
The public keeper uses the same real Herdr/OS identity composition as direct
controller launch. PID comes from the exact pane's `pane.process_info`; Linux
start identity includes boot ID and process start ticks, and macOS uses the OS
process start time. Match the complete durable controller generation, launch,
pane, argv and runtime proof. A running default server or shell cannot stand
in for that proof. Fill only missing transport/runner authority bindings;
explicit supplied callbacks remain intact. Validate registry/index locators
through the strict journal and physical assignment before effects. Unknown OS
identity, locator, lock or inventory retains the original run without a new
start, prompt or reset.

A restarted drive inspects the original stage and claim. Live matching stage:
reattach without prompt. Absent process with saved native id: drive uses the stage adapter's explicit
history-only resume intent with stopped proof and new generation; it never
resends the first stage request. Prove that request in history and reconcile
known/uncertain effects before any gated recovery continuation.
Unproved prompt/effect: inspect only. New turn authority never comes from a
heartbeat age. Use frozen bytes and recorded runtime even after `current` flips.

## Public recovery service and restore scope

Alpha owns the boot/login recovery service `pdd runs-keeper`, installed by
`pdd setup`, independent of Link, accounts and fleet sign-in. Module function
`runWorkflowKeeper({home},ports)` runs the discovery/reconciliation pass every
30 s without overlapping passes. It holds `~/.pdd/runs/keeper.lock` for its
lifetime; a competing service/Link owner exits with a finite busy result and
launches nothing. A stop signal ends scheduling, releases its own lock and
returns exitCode 0. Link reuses this public implementation when installed;
it does not install a second recovery policy. The installer owns service files.
On Mac the owner starts at login; Linux boot recovery needs user linger.

The public restore shim restores only a durable managed launch record. Check
its saved owner, current generation/successor, native claim, recorded runtime
and flags before restore; stage restore belongs to its controller. A managed
account restore also re-reads the current machine/tool policy and reconciles the
shared transition through its adapter. Saved actual account/model observations
remain evidence, not account preferences; a fixed-account quota question stays
stopped. Recovery never answers it or independently selects another account. The optional
account adapter follows the [managed invocation boundary](../accounts/wrapper.prompt.md).
The generic restore/claim path remains available without that adapter.

Herdr startup follows the [launcher process-ownership contract](pdd-launch.prompt.md);
recovery must preserve its separate service/context, including when initially absent. Test Alpha alone through controller death, reboot and
update, with one current stage process and no repeated first prompt.

## Dependencies

- [Story](../../story/cli/WORKFLOW-KEEPER.md) and [cases](../../vectors/cli/workflow-keeper.json): verification; expected outcomes, not observed results.
- [Runner journal reader](workflow-runner.prompt.md): required generation/runtime
  `readWorkflowJournal`, the strict complete history/path validator. This reader
  authorizes no effects; the controller rechecks under its lock.

- [Controller launch](workflow-controller.prompt.md): required generation/runtime
  for durable launch admission and actual process proof.
- [Claims](workflow-claims.prompt.md): required generation/runtime for kernel
  locks and current-generation exclusion.
- [Run records](workflow-run-records.prompt.md): required generation/runtime
  for locating runs and bounded read-only journal inspection.
- [Frozen runtime](workflow-runtime.prompt.md): required generation/runtime
  validation; missing versions stop recovery.
- Supplied fs, monotonic/time observations and Herdr inventory: runtime inputs.
  Strict runner journal validation precedes effects; lenient display
  readers alone cannot authorize recovery.

[Managed invocation boundary](../accounts/wrapper.prompt.md) is navigation-only
for the optional adapter. [Launcher process ownership](pdd-launch.prompt.md) is
required generation/runtime context for service startup; recovery never owns a
second service policy.
