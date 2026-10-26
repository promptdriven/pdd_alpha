# Tell the person when an enabled trace cannot be written

Own `src/trace-warning.mjs`. Export synchronous module function
`warnTraceWriteFailure(error, ports={})`. Herdr and Git trace writers call it only
when their selected trace cannot be safely recorded. It grants no repair,
command retry, configuration or filesystem authority and never changes an
operation's return value or thrown identity.

Attempt one stderr warning per output-stream object in this process, shared by
both trace sinks and repeated/nested requests. Use `ports.stderr` when supplied,
otherwise `process.stderr`; preserve the stream receiver. The first write
failure wins, even when writing its warning also throws. Disabled tracing,
successful writes and read-only trace/report inspection produce no warning.
Import has no output or filesystem effects.

Each warning is one line starting `Warning: PDD_TRACE could not write:` followed
by a fixed reason and `Fix:` guidance. Accept only known internal `traceReason`
values and known filesystem error codes. Never print raw error messages, paths,
argv, environment or arbitrary properties; even hostile error/stream access must
not escape into the caller. Unknown or unavailable failures use fixed generic
I/O guidance. A failed/unavailable stderr cannot be guaranteed visible, but must
not replace the original operation. For a Node Writable, contain warning-caused
asynchronous write errors as well as synchronous throws, including broken pipes.
Keep existing error listeners and their event delivery intact. Any temporary
warning observer lasts through actual write/error/close settlement, including
delayed stream destruction, and is then removed. Streams that suppress close
events still release observers once actually closed; any settlement check must
neither retain an otherwise unreachable stream nor keep the process alive.
Already closed/destroyed output needs no write. Do not add a
global exception handler, retry the write or keep the process alive for a warning.
Simple supplied `write(text)` sinks remain supported without requiring streams.

| Safe reason | Repair guidance |
|---|---|
| Unsafe directory (ownership, permissions, type or alias) | Check that HOME, ~/.pdd and ~/.pdd/logs are owned directories without links; use mode700 for .pdd and logs. |
| Known ~/.pdd write permissions | Say `~/.pdd is group- or world-writable. Fix: run chmod 700 ~/.pdd.` |
| Known ~/.pdd/logs permissions | Say `~/.pdd/logs has unsafe permissions. Fix: run chmod 700 ~/.pdd/logs.` |
| Unsafe home identity | Use the actual canonical absolute user home, without aliases. |
| Unsafe file (ownership, permissions, type, aliases or hardlinks) | Preserve data and use an owned regular, unlinked mode600 trace file. |
| Oversized trace | Archive the old trace and use a new private trace file. |
| Busy writer | Let the active writer finish; inspect stale lock ownership before removing a lock. |
| Permission denied / read-only filesystem / no space or quota / too many open files | Correct that condition for the private trace directory. |
| Invalid/oversized record or unknown I/O failure | Check the private trace directory and report persistent failures; no raw exception text. |

Warnings do not chmod, chown, remove, replace or follow an unsafe target; they
never redirect traces or retry an API/Git effect. Deduplication retains no error,
path or secret and must not retain streams after they become unreachable.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): required authoring.
- Node process stderr, Writable, WeakSet, WeakRef and unreferenced timers: runtime;
  no imports from private modules,
  network, services, credentials or trace file reads.
- [Herdr trace](herdr-trace.prompt.md) and [Git trace](git-trace.prompt.md):
  navigation-only callers own opt-in selection and safe write outcomes.
