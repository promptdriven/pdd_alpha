# Story: open the native agent with PDD guidance and report its real outcome

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who runs `pdd session` or a recipe shortcut, I want my installed Codex or Claude to open in my terminal and project folder with the full PDD guidance as its first prompt, so that I can work in one ordinary conversation without approval stops. When the conversation ends, I want PDD to report the agent's real exit, so that scripts and I can see what happened.

The [owning prompt](../../prompts/cli/native-session.prompt.md) holds the rules. This Story makes them observable. It preserves the module function `launchNativeSession`, its optional test ports, the exact native argv, the spawn options, the exit codes and the signal rules.

Out of scope: building the guidance text, choosing the default agent, parsing request words, background workflow stages, native login and native conversation resume.

## Observable acceptance criteria

- **AC1:** For `codex`, exactly one spawn of the bare name `codex` receives the five arguments in the prompt's argv table, in order. The trust value holds the absolute cwd as one exact key, also for paths with spaces, quotes, dots, backslashes and equals signs, and for a relative `cwd`.
- **AC2:** For `claude`, exactly one spawn of the bare name `claude` receives the two arguments in the prompt's argv table, in order.
- **AC3:** The last argument is the single prompt: the context, then the `# Person request` heading, then the request text unchanged, including shell metacharacters and flag-like words. A missing or empty request gets the default request, which asks for a guide summary before any Story.
- **AC4:** The spawn options are exactly `cwd` as supplied, inherited stdio and no shell, with no `env` key. The launch writes no files, including no trust entry, in `HOME` or the project.
- **AC5:** The result is the child's integer code from its `close` event, including 0. An `exit` event alone does not settle it. A signal close gives 128 plus the signal number. A close with neither gives 1.
- **AC6:** A not-found executable gives exit code 127. Any other launch failure gives exit code 1. In both cases one `stderr` line names the agent.
- **AC7:** After any result, the launcher does not retry, launch the other agent or relaunch with other flags. A native refusal is returned as its own exit code.
- **AC8:** While the child runs, `SIGTERM` and `SIGHUP` sent to the launcher are forwarded to the child. `SIGINT` is forwarded only when stdin is not a TTY. The launcher keeps waiting for close, also when forwarding throws.
- **AC9:** After the result settles, no signal listener that the launcher added remains, for every ending.
- **AC10:** An agent value other than `codex` or `claude` gives exit code 2 with no spawn, no listener and no diagnostic.

## Cases and evidence

The independent [expected cases](../../vectors/cli/native-session.json) map inputs and child events to these criteria. They were written from the prompt, not from running the module.

Existing tests are evidence for the criteria. This Story does not claim that they ran.

- [`test/cli.test.mjs`](../../test/cli.test.mjs): the native argv and process lifetime test covers AC1 to AC5, AC8 and AC9 with stand-in child and signal objects. The packed-package session test covers AC3, AC4 (inherited stdin, environment and cwd), AC5 (exit codes 7 and 9) and AC6 (127 when `claude` is missing).
- [`test/cli-full-access.test.mjs`](../../test/cli-full-access.test.mjs): stand-in `codex` and `claude` executables cover AC1, AC2 and AC4 through the real entry, with a cwd that holds quotes, a dot, spaces, a backslash and an equals sign.
- [`test/cli-installed-entry.test.mjs`](../../test/cli-installed-entry.test.mjs): covers AC4 (no `env` key, cwd unchanged) and AC3 (the context reaches the last argument).

No existing test directly covers AC7, AC10, the other-launch-failure part of AC6, a relative `cwd`, a close with neither code nor signal, or a forwarding error. Passing these finite cases is evidence, not proof over all paths, signals and native versions.

## Open questions

- [CLI guidance](../../docs/cli.md) and [session guidance](../../docs/prompt-sessions.md) still say the launcher adds no permission or config flags. That text conflicts with the accepted full-access decision. Who updates those documents?
- JSON string escaping matches a TOML basic string for ordinary paths. JSON does not escape the DEL character (U+007F), but TOML requires it to be escaped, so such a path would give an invalid trust value. Is a different encoding or a refusal wanted for that case?
