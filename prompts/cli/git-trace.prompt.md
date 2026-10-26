# Private local Git diagnostics

Own `src/git-trace.mjs`. Give allocator failures an opt-in local diagnostic without
changing Git execution, allocation authority, refusal, or retained work. Preserve
the original command return value or thrown object, including rejected code zero.
No trace failure may retry, repair or change a command result.

The module function `traceGitCommand({argv,cwd}, action, ports={})` invokes the
supplied Git action exactly once. Enable tracing only when the comma-separated
`PDD_TRACE` string contains the case-sensitive token `git` after trimming each
token. Both `herdr,git` and `git,herdr` enable this sink; unrelated tokens never
enable it, and `all`, substrings or case aliases have no special meaning. Append
one redacted JSON line to `~/.pdd/logs/git-trace.jsonl` after the action settles,
including Git argv, cwd, returned/rejected outcome, numeric exit or null when
unavailable, signal/error code when observed, stderr, UTC start/end and monotonic
elapsed milliseconds. Missing exit is zero only for successful execFile-style
completion; an unobserved rejected exit is null. Do not capture stdout, inherited
environment, stdin, credential-helper output or credential files.

The trace contains diagnostic identity, never authentication material. Remove URL
userinfo, query/fragment values, authorization/cookie/credential assignments,
recognized access tokens and private-key material from argv and paths. Retain
only recognized Git diagnostic forms in stderr after redaction; replace unproved
free text rather than recording it. Bound individual fields and record size;
oversized text is omitted, never sliced through an unknown secret. Unknown keys
or text are not safe merely because they came from an existing trace file.

The pure module function `formatGitFailure({argv}, response={})` returns a
bounded public failure description naming the redacted Git step, observed numeric
exit or safe operational error code when available, and the same positively
projected stderr used by tracing. It performs no I/O, does not consult the trace
switch, never includes stdout or an exception's unproved message, and never
mutates its inputs. Collapse diagnostic line breaks to keep the public message
finite. Oversized arguments or stderr are omitted rather than cut through a
secret. An observed GitHub authentication/terminal-prompts-disabled diagnostic
may suggest `Run: gh auth setup-git`; this is guidance only, never an automatic
credential operation or permission to retry. Unknown stderr remains redacted.

Create only the owned `.pdd/logs` directories and private mode0600 trace file.
Refuse symlink/non-directory ancestors and symlink, hardlinked, non-owned or
group/world-accessible existing log files. Diagnostic I/O is best-effort and
never grants worktree, cleanup, network, login or service authority. Disabled
tracing does not inspect or create log paths. Never alter existing permissions
or redirect tracing to another file on failure.

The module function `readGitTrace(ports={})` reads at most the last200 complete
physical lines through a bounded tail read, projects valid records through the
same privacy rules and returns an array of redacted records. Missing, unreadable,
unsafe, incomplete or malformed input is omitted without changing doctor health.
Replacing a checked log with a special file must not block reading or command
completion; reject the opened file when it is no longer an ordinary private log.
It never creates/repairs a file, reads credentials or runs a command. Doctor owns
whether to include this optional field in its support report; adapters cannot
inject untrusted trace records through their report fields.

`ports.home` optionally supplies an isolated absolute existing home;
`ports.env.PDD_TRACE` supplies the trace switch; when absent or null, use
`process.env.PDD_TRACE` even if a supplied filtered environment omits the switch.
An explicit empty string overrides inheritance and disables tracing. If the
selected value is unset, non-string or unknown-only, tracing stays off. Do not
mutate or log either environment, and treat unavailable selector access as disabled while preserving
the one original action. The default home is the actual user home. These
diagnostic inputs grant no Git authority.

[Worktree allocation](workflow-worktree.prompt.md) owns the caller's command and
custody rules; [doctor](doctor.prompt.md) owns the report. These caller links are
navigation only, not required context for generating this independent helper.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): authoring.
- [Story](../../story/cli/GIT-TRACE.md) and [cases](../../vectors/cli/git-trace.json):
  verification; independent expected privacy and no-effect observations.
- Runtime: Node filesystem, path, os, performance and time; no external dependency,
  sign-in, network, subprocess or credential access.
