# Story: updates preserve running work

Draft for review. As a person with agents and a run open in Herdr, I want an
update started in that pane or over SSH to finish after I close the terminal,
with the same agent and controller processes. The
[contract](../../prompts/cli/detached-updater.prompt.md) owns install effects.

- **AC1:** An accepted job has a durable identity and independent launch context.
  Repeating the request joins it. Failed/uncertain detach does not run inline twice.
- **AC2:** Stage verifies exact artifacts, provenance, owned Node, disk, read-only
  doctor and all retained-runtime compatibility before activation; failure preserves
  current and real user state.
- **AC3:** Activation revalidates target authorization and acquires a durable drain
  barrier. After 24 h it can stop waiting for joins/sign-ins but never bypasses
  action durability, the drain or an active person check.
- **AC4:** Normal flip preserves old current as previous. Compare target client
  digest/Node against the running Link; CLI-only change causes zero Link restarts.
- **AC5:** Link changes restart Link alone. Herdr, agents, controllers, pinned stage
  runtimes, native sign-ins, worktrees and journal content remain intact.
- **AC6:** Recovery before/after flip joins proved live work, finishes the recorded
  decision once, and preserves ambiguity as recovery_required. Only the launcher's
  ten-minute failed-start rule applies; the updater adds no rollback timer.
- **AC7:** Alpha-only activation needs no private service and never starts Link.
- **AC8:** Stage downloads and self-tests run outside update.lock; publication and
  activation use short locked sections with revalidation. The public proprietary
  npm client needs no user registry token. Any helper-output mismatch on identical
  live snapshot/time fails staging.

[Cases](../../vectors/cli/detached-updater.json) describe failures and interleavings.
Real process survival, power-loss recovery and compatibility remain unrun.
