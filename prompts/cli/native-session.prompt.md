# Native session launcher

Owns `src/native-session.mjs`. Exports the module function `launchNativeSession({ agent, cwd, context, request, stderr }, { spawn, signals, stdinIsTTY })`, which returns a Promise of an integer exit code.

It opens one foreground native conversation for a session or a recipe shortcut. It starts the installed `codex` or `claude` CLI in the person's terminal with the PDD guidance as the first prompt, waits for the conversation to end, and reports its [exit code](#exit-code). The promise never rejects. Its caller is [CLI dispatch](pdd-cli.prompt.md). Workflow stages start through [background stages](workflow-stage-herdr.prompt.md) instead.

Inputs: `agent` is `codex` or `claude` (the caller applies the default `codex`). `cwd` is the project folder. `context` is the complete guidance text from [guidance](guidance.prompt.md), used as supplied. `request` is optional person text, default empty. `stderr` receives launch diagnostics, default `process.stderr`. The optional second argument replaces process access in tests: `spawn` (default `node:child_process` `spawn`), `signals` (default `process`) and `stdinIsTTY` (default: whether `process.stdin` is a TTY).

Preservation: behavioral refinement. Keep the export, its binding kind, parameters, defaults, exact argv and spawn options, exit codes, signal rules and forbidden effects. Diagnostic wording and private structure may vary.

## Native launch

Accepted product decision: native agents that this package launches run with full access and no approval prompts. The flags below are the only permission change.

Both CLIs accept one positional initial prompt. Build exactly one prompt argument: `context`, then `\n\n# Person request\n`, then the request text unchanged. A missing or empty `request` gets a fixed default: summarize the relevant Prompting guide method and the available manual workflows, then ask what the person wants to work on, and draft no Story before that summary.

| Agent | Arguments, in this order |
| --- | --- |
| `codex` | `--no-daemon`, `--dangerously-bypass-approvals-and-sandbox`, `-c`, `projects={"<absolute cwd>"={trust_level="trusted"}}`, prompt |
| `claude` | `--dangerously-skip-permissions`, prompt |

`--no-daemon` selects the supported Codex foreground route, so incompatible settings on a shared Codex server cannot block this launch. Do not restart or reconfigure a shared server.

<details>
<summary><strong>Codex folder-trust override: encoding and reasons</strong></summary>

The `-c` value is one argv element. It trusts the selected folder for this invocation only, so Codex does not stop at its folder-trust question. Never write a trust entry to disk.

`<absolute cwd>` is `cwd` resolved against the launcher's current directory, written as a double-quoted string with JSON string escaping. It is a quoted key inside the inline-table value. Codex 0.159.1 splits `-c` override keys on literal dots, so the override key must be the root key `projects`, never a dotted key that holds the path. Codex's TOML value parser then reads the path as one exact key, including spaces, quotes, dots, backslashes and equals signs.

</details>

Start the child once with `spawn(agent, argv, { cwd, stdio: 'inherit', shell: false })`: the bare name found through `PATH`, the `cwd` as supplied, inherited stdio and no shell. The options have no `env` key, so the environment, login and native settings stay unchanged. Without a shell, metacharacters, quotes and flag-like words in the request stay literal prompt text.

Forbidden: any other argument (model, provider, effort, profile, config, or the person's native flags); a shell or wrapper path; a changed environment or `HOME`; credential or auth repair; global native configuration writes; replacement system instructions.

## Exit code

The first matching row wins.

| Ending | Exit code |
| --- | --- |
| `agent` is not `codex` or `claude` | 2, before any effect |
| Launch failed with `ENOENT` (not found) | 127 |
| Other launch failure (`spawn` threw or the child emitted `error`) | 1 |
| Child closed with an integer code | That code, including 0 |
| Child closed by a signal in the OS signal table | 128 + its number, for example 130 for `SIGINT` |
| Any other close | 1 |

**Wait for close.** Settle only on the child's `close` event, not on `exit`, because exit can come before stdio closes. A launch failure wins over a later `close` code.

**Launch diagnostic.** On a launch failure, write one `stderr` line that names the agent and the next step. For not found: install and sign in with that tool, then run the command again. Otherwise: check that tool and the size of the bundled instructions, because a long prompt can exceed the OS argument limit.

**No recovery.** Never retry, install, switch agents, drop the full-access flags or try another permission mode. A native consent stop or refusal is the real result: return its exit code and do not answer for the person.

## Signals while the child runs

After a successful spawn, listen on `signals` for `SIGINT`, `SIGTERM` and `SIGHUP`. The listeners keep Node from ending the launcher, so it keeps waiting for close.

| Signal | stdin is a TTY | stdin is not a TTY |
| --- | --- | --- |
| `SIGTERM`, `SIGHUP` | Forward | Forward |
| `SIGINT` | Do not forward | Forward |

In an interactive terminal, Ctrl-C already reaches the whole foreground process group, so a forwarded `SIGINT` would duplicate it. Forward each received signal once, by name. Ignore a forwarding error and keep waiting. Other signals keep Node's default behavior.

**Listener cleanup.** When the result settles, remove every listener this launcher added, and only those. Settle once.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) — authoring and review method for this prompt.
- [public boundary](public-boundary.prompt.md) — shared command scope, exit codes and the full-access decision (authoring, generation). Local consequence: the codes above, and no global permission or configuration rewrite.
- Node built-ins (runtime): `node:child_process` `spawn` starts the agent; `node:os` `constants.signals` gives signal numbers; `node:path` `resolve` makes the trust key absolute; `process` supplies default signals, `stdin.isTTY` and `stderr`.
- `codex` CLI (runtime): started with the Codex argv; the `-c` key rule is checked against Codex 0.159.1.
- `claude` CLI (runtime): started with the Claude argv.
