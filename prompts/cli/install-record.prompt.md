# Durable install record

Own `src/install-record.mjs` and the schema of `~/.pdd/install/record.json`.
Draft for review; new work, behavioral refinement. Record install progress,
attempt-specific startup results and pending reports so a different process can
recover after a crash. The record does not select releases or own run state.

Module functions `readInstallRecord({home}, ports)` → `{value, code}` and
`writeInstallRecord({home, lease, expectedRev, next}, ports)` → `{value, code}`
read and compare-and-replace one record. Code is null on success; writes require
the real install lease. A stale revision gives `stale_record` without mutation.
No unlocked writer, including Link, may edit this file. Private helpers are free.

<details>
<summary><strong>Required record fields and durable replacement</strong></summary>

`{v:1, rev, transaction, staging, starts, rejected, reports}` is additive JSON.
`rev` is a nonnegative increasing integer. Initial state has rev 0, transaction
null, staging/starts/rejected empty maps and reports an empty array. A missing record
means no managed install; it is not evidence that an existing current is safe.
Fleet setup owns one additive field, `fleetSetup`, written through
`writeInstallRecord` under the same lease and revision (see
[fleet setup](../fleet/setup.prompt.md)); there is no second install-state file.

`staging[id] = {requestId, target, paths, phase, processProof}` registers each
detached job independently; phase is `downloading`, `staged`, `checked` or `failed`.
Paths name that job's unique temporary folders. Short locked checkpoint updates
preserve other jobs and the active transaction; no download holds the lock. A
repeated requestId returns its existing job. Uncertain process proof never starts
a duplicate job. Publishing a checked job selects it as the serial activation.

`transaction` is null or `{id, phase, from, to, restartRequired, barrierId,
manifestSeq, error}`. `from` is Runtime or null for first install; `to` is Runtime.
Phases: `locked`, `staged`, `checked`, `activating`, `flipped`, `link_restarted`,
`ready`, `rolling_back`, `rolled_back`. `barrierId` is null before drain.
Persist an intent phase before its nonrepeatable effect. Paths and the record
may disagree after power loss; recovery checks both before repeating anything.
For Alpha alone, ready means the local package/runtime checks completed.

`starts[releaseId] = {runtime, consecutiveFailures, pending, lastSuccess}`.
`pending` is null or `{attemptId, bootId, processProof, startedAt, deadlineAt,
deadlineRegistration, state}`; state is `starting`, `ready` or `failed`.
The launcher supplies deadlineAt in the same boot's local elapsed-clock units as
startedAt; registration identifies its one-shot platform deadline. The
[launcher](pdd-launch.prompt.md) owns startup success/failure classification;
this record stores the supplied attempt and outcome without a second timer policy.
`processProof` is null in the durable pre-launch intent,
then binds the actual process instance, not a reusable PID alone. A crash before
proof is persisted is uncertain until reconciled; null does not permit a blind
second launch. `lastSuccess` is null or the accepted attempt id.
The exec launcher records a start before exec. Link's startup-success path writes
matching durable ready, then clears its unresolved entry and resets the counter
through this module under the lease. A supplied failed outcome increments
consecutiveFailures once. Failed
attempt identities stay recoverable until reconciliation cannot duplicate them.
Late ready and duplicate callbacks cannot reset an accepted failure. An old
attempt is reconciled using ready, boot, process and registered deadline evidence;
unknown process identity never permits killing a possible successor. Unknown
evidence stops unsafe effects with `recovery_required`.

`rejected[releaseId] = {alphaDigest, clientDigest, reason, transactionId}`
remembers a locally failed release across reboot, new hints and manifest edits.
Only a different published release is an automatic retry candidate. Reports are
`{id, type, releaseId, fallback, reason, delivered}`; type is `release.ok` or
`release.block`. Persist before delivery; retry delivery by the same report id.
Reports contain no account, token, prompt, message or device credential.

Create missing PDD directories at exactly 0700 through the private-directory
owner, repairing existing `.pdd` and direct mutable children only; preserve
existing deeper directory modes and immutable runtime receipts. Create the record 0600. Refuse aliased
or differently owned directories without replacing the record. Write the complete JSON to an
exclusive temporary sibling, fsync it, rename atomically and sync the containing
directory before an effect depends on it. ENOSPC, interrupted write or rename
failure keeps the last complete record and gives `record_io`; do not launch or
flip based on an unpersisted transition. Never replace malformed JSON with empty
state: `record_damaged` stops mutation and preserves the evidence. Preserve unknown
fields on rewrites; unknown phases give `recovery_required`, never ready.

</details>

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): authoring.
- [Private directories](pdd-directory.prompt.md): generation/runtime for private
  PDD ancestors of durable record files.
- [Install lock](update-lock.prompt.md): required for generation/runtime writes;
  determines valid exclusive lease ownership.
- [Versions](versions.prompt.md): required for generation/runtime; owns Runtime.
- [Story](../../story/cli/INSTALL-RECORD.md) and
  [cases](../../vectors/cli/install-record.json): required for verification.
