# Story: the foreground native conversation launch

As a person who types `pdd session`, I want PDD to start my installed Codex or
Claude in the foreground with the full-access flags, my chosen model and effort,
and the composed context, and then to behave like the native tool itself, so
that nothing in the launch surprises me. The owning prompt is
[native local conversation launch](../../prompts/cli/native-session.prompt.md).
Examples are synthetic.

## Observable acceptance criteria

- **AC1:** The spawned command is exactly `codex` or `claude` by name, with the
  argv `nativeArgs({agent, cwd, selection})` from [native flags](NATIVE-FLAGS.md)
  followed by one positional element that holds the composed context and the
  optional request text, unchanged, including shell metacharacters. No shell is
  used.
- **AC2:** The child inherits stdio, the current environment and the resolved
  `cwd`. No environment variable, config file, auth file or trust entry is
  written or changed.
- **AC3:** `selection` is passed to `nativeArgs` unchanged; `null` adds no model
  or effort flag. The module never chooses a model, effort, provider or account.
- **AC4:** The returned promise resolves to the child's integer exit code after
  the child closes; a signal exit maps to 128 plus the OS signal number.
- **AC5:** A missing native executable returns 127 with one actionable line on
  stderr; any other spawn failure returns 1. There is no install, fallback,
  retry or second launch mode after a refusal.
- **AC6:** SIGTERM and SIGHUP sent to the wrapper are forwarded to the child
  once. SIGINT is forwarded only when stdin is not a TTY; with an interactive
  foreground terminal it is not duplicated. Temporary listeners are removed
  after the child closes.
- **AC7:** The native tool's own consent prompt or root refusal is the real
  outcome: the wrapper never auto-answers, retries or escalates.

The independently authored [expected cases](../../vectors/cli/native-session.json)
map inputs to these criteria. Expected values come from the contract, not from
running code.
