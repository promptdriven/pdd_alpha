# Local Herdr diagnostic trace

Own `src/herdr-trace.mjs`. Export async module function
`traceHerdrRequest({operation,request}, invoke, ports={})` and synchronous module
function `readHerdrTrace(ports={})`. Preserve the exact invocation, returned value
or thrown error of the supplied operation. Diagnostics grant no launch, identity,
admission, retry, repair or acceptance authority.

Only the exact environment setting `PDD_TRACE=herdr` enables recording. Use
`ports.env` when supplied, otherwise the process environment; do not serialize it.
When disabled, invoke once without any trace filesystem access. When enabled,
attempt a request record before invoking once, then a matching reply or error
record with elapsed monotonic milliseconds. Record epoch milliseconds, monotonic
time, a generated correlation UUID and the known operation. Tracing failures must
never change the operation's result, error, effects, timing guards or retry count.
No trace I/O or subprocess occurs at module import.

The local sink is `<home>/.pdd/logs/herdr-trace.jsonl`, where home is explicit
`ports.home` or Node's actual homedir. Create missing owned directories privately
(0700), and the trace and transient exclusive writer file as 0600. Reject aliases,
nonregular/multiply linked files, foreign ownership, writable parent directories,
permissive log directories/files and oversized input; never repair, follow or
replace such a target. Bound the trace to 1 MiB and each record to 4096 bytes.
When compacting, retain at most the last 200 positively projected records within
that bound. A busy or unavailable sink may omit diagnostics; it never retries an
API effect. The trace is supplementary evidence, never proof that an unrecorded
request did not occur.

## Printable observations

Project payloads and replies positively from known diagnostic fields, including
JSON subprocess stdout when valid. Retain only recognized operation/reply kinds,
known state/error vocabulary, booleans, bounded numeric times/counts/PIDs,
structurally valid public workspace/tab/pane/terminal IDs and workflow/launch
UUIDs. A Linux numeric process-start identity may be retained; unknown identity
text is omitted. Inspect only own data properties; never evaluate payload, nested runtime, argument
or error accessors. Bound nesting and array lengths. Runtime diagnostics expose
field presence and numeric versions, never executable paths or arbitrary release
metadata. Argv diagnostics expose counts and the validated workflow-drive UUID
binding only; omit all argument text. Never record prompt/message/screen text,
pane command text, environment, paths, URLs, credentials, approval proofs, raw
stdout/stderr, arbitrary error messages, unknown fields or unproved free text.
Malformed or unknown observations are omitted, not made printable by escaping or
hashing them. Keep the original unredacted value solely in the operation's caller.

`readHerdrTrace` is read-only and works independently of whether recording is
currently enabled. Inspect only the fixed owned trace path with the same file
safety and size rules. Select the last 200 complete physical JSONL lines before omitting invalid rows;
an interrupted final line is not a complete record. Return safe records after
revalidating the trace schema and positively projecting each payload again.
Missing, unsafe, malformed or unreadable facts are omitted; never print raw log
bytes. Opening an unsafe nonregular target such as a FIFO must not block before refusal.
No directory/file creation, permission repair or network call on reads.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): authoring.
- [Controller](workflow-controller.prompt.md), [runner](workflow-runner.prompt.md)
  and [stage transport](workflow-stage-herdr.prompt.md): navigation-only consumers retain
  their independent process, lock, journal, lifecycle and no-repeat authority.
- [Doctor](doctor.prompt.md): navigation-only read-only support-report consumer.
- Node filesystem, monotonic performance clock, UUID generation and homedir:
  runtime. Tests use synthetic replies and isolated temporary homes; no live call
  or operational capture is a bundled fixture.
