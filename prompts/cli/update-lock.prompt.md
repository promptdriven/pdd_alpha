# Install and update exclusion

Own `src/update-lock.mjs`. Draft for review; new work, behavioral refinement.
Own the one kernel lock on `~/.pdd/update.lock` for setup and activation, including
their record updates, startup recovery, rollback and version collection. Download
staging is outside this lock. Own `launcher/native/build.mjs` as the release-time
native build entry: build the kernel lock and the private-directory owner's
separate executable for the current supported platform/architecture. Building
that directory helper does not change kernel-lock behavior or grant it leases. Concurrent install mutations wait without
corrupting an install. A process id or an old file is never lock ownership.

Module function `withUpdateLock({home, onWait, signal}, operation, ports)` runs
`operation(lease)` once after exclusive acquisition and returns its result. A
waiting caller gets one `onWait("Another setup or update is running. Waiting…")`.
Cancellation before acquisition gives `cancelled` and no operation. A kernel-lock
failure gives `lock_unavailable`; there is no PID-file fallback. Exceptions inside
the operation propagate after release. Internals and the native binding are free.

Before acquisition secure `~/.pdd` and its existing direct mutable children
through `repairPrivatePddHome` from the
[private-directory owner](pdd-directory.prompt.md). Do not traverse runtime trees
or change their receipts. A symlink, different owner or
failed repair gives `lock_unavailable` without invoking the operation. Preserve
the persistent lock inode and all lease/lifetime rules.

<details>
<summary><strong>Lifetime, durable lock identity and nested callers</strong></summary>

Use an actual process-held exclusive advisory lock on a persistent file, supported
on Mac and Linux by the bundled local locking facility. Creating a file with a PID
does not satisfy this contract. The OS releases the lock when the owning process
dies. Never steal a lock because of age, a stale PID or an apparent hang. Never
unlink or replace the lock file: two inodes must not become two locks.

The detached updater acquires its own lease; the invoking CLI does not hold a
lease while waiting for that updater. Helpers receive the existing lease rather
than reacquire it. Keep the lease through the durable phase transition and its
filesystem effects. Staging downloads, extraction, integrity checks and read-only
self-tests use unique transaction-owned temporary folders without the lease;
they may overlap setup or another staged download. Never hold update.lock across
those downloads. Short checkpoint writes and final publication/activation use
the common lease. Revalidate artifacts, references, target authorization and the
actual predecessor after acquisition. Concurrent equal artifact publication must
reuse verified identical bytes or fail; it cannot overwrite a live folder.
Cancellation before flip leaves the active install intact.

Only the actual owner releases the lock. Transfer across an exec, when used, must
retain the same kernel ownership; a forked child's copied token is insufficient.
Callback return/error closes the owned descriptor. Read-only status may inspect
the last durable record without this lock and cannot claim it is current truth.

</details>

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): required for authoring.
- [Private directories](pdd-directory.prompt.md): required generation/runtime
  context for the owned install directory before lock acquisition.
- [Story](../../story/cli/UPDATE-LOCK.md) and [cases](../../vectors/cli/update-lock.json):
  required for verification.
- Runtime: a bundled kernel-lock binding/helper on Mac and Linux; it must work
  without fleet sign-in, Link or a system-installed Node. Its exact implementation
  is free, but cross-process exclusion and death release are required.
