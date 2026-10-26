# Keeper decision diagnostics

Own `src/workflow-keeper-log.mjs`. Preserve recovery authority outside this module.
Record why a run was or was not restarted, without recording run context or secrets.

Module function `appendKeeperDecision({runId,decision,code,at,journalSeq,controller},ports)`
appends one JSON line to `~/.pdd/logs/keeper.jsonl`, with version 1. Require UUIDv4
runId (invalid inputs may use null), bounded lowercase machine decision/code
identifiers or null, finite nonnegative time, nonnegative safe journalSeq or null,
and controller `absent`, `held`, `started` or `unknown`. Optional `reason` is
only `server_absent` paired with `herdr_not_found`; optional `resetAt` is a finite
nonnegative epoch-millisecond time representable as UTC, paired with `launch_budget`.
Retain these structured diagnostics, and reject invalid supplied values.
Old rows without them remain valid. Keep only these fields;
never arbitrary errors or paths. Return `{ok}`; errors do not throw or steer recovery.
The keeper serializes passes. Create private directories through the directory
owner and use an owned, singly linked regular mode0600 file with no followed final
symlink. Retain at most 1 MiB; when full retain recent complete rows before appending.
A corrupt or unsafe log refuses writing without changing its bytes: before append
or retention, every existing complete row must parse and satisfy the record schema.
An incomplete final row also refuses writing. Reading remains lenient as below. PDD_TRACE's comma-separated `herdr` selector
also traces the diagnostic through the existing redacting trace owner; no selector
creates no trace file. Logging creates no controller, native call or credential read.

Module function `readKeeperDecision({runId},ports)` reads at most 1 MiB from that
same owned ordinary log and returns its last valid complete matching row, or null.
Ignore an incomplete final line and invalid rows. Never create directories or
repair a file when reading. Ports may supply home, fs, stderr and trace environment.
All timestamps and sequences are observations, never launch authorization.

## Dependencies

- [Private directories](pdd-directory.prompt.md): required generation/runtime for
  directory creation without unsafe pathname mode repair.
- [Herdr trace](herdr-trace.prompt.md): required generation/runtime for opt-in
  positive projection, bounded output and diagnostic-only failures.
- Node fs/path/os: ordinary local bounded I/O. No service or private dependency.
