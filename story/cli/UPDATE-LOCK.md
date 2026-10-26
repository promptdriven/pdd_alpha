# Story: setup and update never race

Draft for review. As a person rerunning setup during an update, I want one owner
to finish its durable install step while the other waits. The
[contract](../../prompts/cli/update-lock.prompt.md) owns the lock.

- **AC1:** Setup and activation (with record, rollback, recovery and GC mutations)
  share one real kernel lock on the persistent update.lock inode. Only one such
  mutation runs. Download staging uses unique temporary folders outside the lock.
- **AC2:** Waiting reports the stated wait message once; cancellation before
  acquisition performs no operation or active mutation.
- **AC3:** Process death releases kernel ownership. A stale PID/file does not
  imply a live lock or authorize stealing a live lock.
- **AC4:** Failure to acquire the real lock stops effects without PID-file fallback.
  Callback failure releases the lock and preserves that failure result.
- **AC5:** Nested helpers use the lease; an invoking CLI never holds it while a
  detached updater waits. A later activation reacquires and revalidates state.
- **AC6:** Staging downloads, extraction and read-only self-tests can proceed while
  setup owns the lock; final publication/checkpoints wait for short critical
  sections and revalidate the actual predecessor and immutable bytes.

[Cases](../../vectors/cli/update-lock.json) specify concurrency expectations. Real
cross-process and across-exec checks remain implementation-stage work.
