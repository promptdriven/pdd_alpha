# Diagnose a failed allocation without sharing credentials

As a person running an issue workflow, I can opt into local Git diagnostics and
include their recent redacted records in a support report, so an allocation refusal
can be diagnosed without losing work or exposing authentication.

- With `PDD_TRACE=git`, settled allocator Git calls record command/location,
  actual exit/error, redacted stderr and timings in the user's private log.
- With tracing disabled, no diagnostic log is read or written.
- Credentials, headers, URL authentication and unproved diagnostic text are absent
  from both the file and `doctor --report`.
- A logging failure changes neither the Git result nor allocation/claim safety;
  a log replaced with a special file does not block the report or command.
- Doctor includes at most the last200 complete applicable trace lines, reads only,
  and omits unsafe or malformed records without failing unrelated health checks.
