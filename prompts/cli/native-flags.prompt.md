# Native agent launch flags

Own `src/native-flags.mjs`.

This module is the one place that decides the native arguments for a Codex or
Claude launch: the full-access flags, the per-launch folder trust for Codex,
the resume selector and the validated model and effort selection. `pdd session`, the workflow stages, Link and the
[Link launcher shims](../phone/link/launchers.prompt.md) all import it, so the
launch modes cannot drift apart.

**Preservation:** new work, behavioral refinement. The export and the exact
argument lists below are the contract; internals are free. A fresh
full-access launch gets what `pdd session` and the workflow stages pass today,
plus one new Codex flag (`--dangerously-bypass-hook-trust`, see
[hook trust](#hook-trust)).

## What it returns

The public owner is the module function
`nativeArgs({agent, cwd, fullAccess = true, resume = null, selection = null}) → string[]`. It is
pure and synchronous: no file, process, environment or clock access. Each call
returns a new array. It never changes its input.

Inputs:

- `agent`: exactly `codex` or `claude`.
- `cwd`: the absolute folder the agent works in, resolved by the caller. This
  module uses the text as given and never normalizes it.
- `fullAccess`: `true` (also when the property is missing) or `false`.
- `resume`: `null` (also when missing) for a fresh launch, or the native
  session id to resume, from a durable source (Herdr, the agent book or a
  session log). This module never makes one up (I2).
- `selection`: `null` (also when missing), or the validated `{model, effort}`
  pair that [machine CLI models](workflow-models.prompt.md) returned as
  `result.selection` (`effort` may be `null` for a model with no effort
  control). This module never chooses, checks or changes a model or effort; it
  only writes the pair as flags. See [model and effort](#model-effort).

Here `T` is the one trust element `projects={<cwd key>={trust_level="trusted"}}`
built by the [trust rule](#trust-element) and `<id>` is `resume`.

| `agent` | `fullAccess` | `resume` | Result, in order |
|---|---|---|---|
| `codex` | `true` | `null` | `--no-daemon`, `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`, `-c`, `check_for_update_on_startup=false`, `-c`, `T` |
| `codex` | `true` | id | `resume`, `--no-daemon`, `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`, `-c`, `check_for_update_on_startup=false`, `-c`, `T`, `<id>` |
| `codex` | `false` | `null` | `--no-daemon`, `-c`, `check_for_update_on_startup=false` |
| `codex` | `false` | id | `resume`, `--no-daemon`, `-c`, `check_for_update_on_startup=false`, `<id>` |
| `claude` | `true` | `null` | `--dangerously-skip-permissions` |
| `claude` | `true` | id | `--dangerously-skip-permissions`, `--resume`, `<id>` |
| `claude` | `false` | `null` | (empty list) |
| `claude` | `false` | id | `--resume`, `<id>` |

<a id="model-effort"></a>**Model and effort (S58).** With a non-null
`selection`, the list above gets these elements appended, after the last
element of the row and before `<id>` when there is one:

| `agent` | `effort` | Appended, in order |
|---|---|---|
| `codex` | `null` | `-m`, `<model>` |
| `codex` | text | `-m`, `<model>`, `-c`, `model_reasoning_effort="<effort>"` |
| `claude` | `null` | `--model`, `<model>` |
| `claude` | text | `--model`, `<model>`, `--effort`, `<effort>` |

The Codex effort element is one argv element with the double quotes inside it
(TOML string). `<model>` and `<effort>` are the native values from the catalog,
copied unchanged. Flag names: Codex `-m, --model <MODEL>` and `-c <key=value>`
with the `model_reasoning_effort` config key; Claude Code `--model <model>` and
`--effort <level>` (checked in the installed versions on Sun Oct 25 2026; the
Story cases pin them). A `selection` that is not `null` and not an object with a
string `model` and a string-or-null `effort` is a `TypeError`.

Why this order: `resume` is a Codex subcommand, so it comes first, and Codex
reads its options before the session id. Claude's `--resume` takes the id as the next
element. Codex keeps `--no-daemon` without full access because it is launch
compatibility, not permission: a shared background server with other settings
must not block this launch. Every Codex invocation also gets the one-shot
`check_for_update_on_startup=false` override, so a startup update menu cannot
block an unattended PDD launch; this does not write the user's Codex config.

<a id="hook-trust"></a>**Hook trust.** `--dangerously-bypass-hook-trust` runs
enabled Codex hooks for this launch without saved hook trust, and writes
nothing to the Codex config. The Herdr Codex integration adds a SessionStart
hook that reports the native session id to Herdr. Without the flag a
full-access Codex stops at "Hooks need review" while Herdr reports `idle`,
and nobody sees it.

<details>
<summary><strong>Caller boundary — what is never in the list</strong></summary>

- No executable name. The caller starts `codex` or `claude` by name.
- No positional prompt or context. The caller appends it last when it has one.
- No transport boundary. A Herdr caller puts its own `--` before this list.
- No other native flag: no profile, sandbox mode, approval policy, added
  folder, working-folder flag, config write or environment change. Model and
  effort appear only through the validated `selection` above.
- A caller never adds, removes or reorders these elements, and never adds its
  own permission flag. A refused launch is not retried with other flags.

Local consequence per caller:

| Caller | Use |
|---|---|
| [Native session](native-session.prompt.md) | Spawn the native agent with `nativeArgs({agent, cwd: <resolved absolute cwd>, selection})` followed by the one composed context element. `selection` is the pair `pdd session` resolved from `--model`/`--effort` and the Settings defaults, or `null`. |
| [Workflow stage transport](workflow-stage-herdr.prompt.md) | Herdr `agent start … --` followed by `nativeArgs({agent, cwd: <assigned worktree>, selection: launchSelection})`. |
| [Link actions](../phone/link/actions.prompt.md) | Herdr `agent.start` `args` = `nativeArgs({agent: kind, cwd, fullAccess, resume, selection})`, with `selection` the exact `result.selection` from `resolveWorkflowModel`, or `null`. |
| [Link launcher shims](../phone/link/launchers.prompt.md) | A full-access resume or a Claude resume in a Herdr pane gets `nativeArgs({agent, cwd: <real cwd>, fullAccess, resume})`, then the other original arguments. An ordinary Codex launch gets `nativeArgs({agent: "codex", cwd: <real cwd>, fullAccess: false, resume: null})` before its original arguments, with the caller-owned `--no-daemon` prefix dedup exception above. |

</details>

<a id="trust-element"></a>
<details>
<summary><strong>Codex trust element — one argv element, TOML quoting</strong></summary>

`T` is the text `projects={` + K + `={trust_level="trusted"}}` as ONE argv
element, where K is `cwd` written as a TOML basic string:

- Start and end with `"`.
- Write `\` as `\\` and `"` as `\"`.
- Write U+0008 as `\b`, U+0009 as `\t`, U+000A as `\n`, U+000C as `\f` and
  U+000D as `\r`.
- Write every other character from U+0000 to U+001F, and U+007F, as `\u` plus
  four lowercase hex digits (for example `\u001b`, `\u007f`).
- Copy every other character unchanged, including spaces, dots, `=`, `'`,
  `#`, `[`, `]` and non-ASCII letters.

For every path without U+007F this is the same text as the path's JSON string
form, so it equals today's output.

The override key MUST be the plain root key `projects`: Codex splits `-c` keys
on literal dots, so a path inside a dotted key would break. The path is a
quoted key INSIDE the inline-table value, which Codex parses as TOML, so the
exact folder gets an exact map key. The trust applies to this one launch and
this folder only; nothing is written to disk.

</details>

<details>
<summary><strong>Input errors</strong></summary>

A caller bug throws `TypeError` before any result. The message is free.

| Input | Accepted | Else |
|---|---|---|
| argument | a plain object | `TypeError` |
| `agent` | the exact strings `codex`, `claude` (case-sensitive, no trimming) | `TypeError` |
| `cwd` | a string that starts with `/`, has no U+0000 and no unpaired surrogate | `TypeError` |
| `fullAccess` | missing, `true`, `false` | `TypeError` (also for `null`, `"true"`, `1`) |
| `resume` | missing, `null`, or a UUID text `8-4-4-4-12` hex digits (either case), passed unchanged | `TypeError` (also for `""`, a session name, a `p`+hex log id) |
| `selection` | missing, `null`, or `{model: <non-empty string>, effort: <non-empty string> or null}` | `TypeError` (also for `{}`, a missing `effort` property, `{model: ""}`, a number) |

Other properties of the argument are ignored. `cwd` is required for every call,
also when the result does not contain it, so a caller bug shows early.

</details>

<details>
<summary><strong>Unresolved points (provisional rules above)</strong></summary>

- Codex 0.159.1 and 0.160.0 accept `--dangerously-bypass-hook-trust` on the main command and on `resume`; later versions are not checked.
- The resume order was read from help text, not a real launch (Codex 0.160.0: `codex resume [OPTIONS] [SESSION_ID] [PROMPT]`; Claude Code 2.1.310: `claude [options] [prompt]`, `--resume [value]`).
- Codex `-m` on `resume`: the help text lists `-m` on `codex resume` too; a real resume with a model change is not tested.
- U+007F escaping and the `TypeError` for a relative path, U+0000 or an unpaired surrogate are new; today such a path gives invalid TOML or a spawn error.

</details>

## Dependencies

| Input | Role | Uses |
|---|---|---|
| [Prompting guide](../../docs/prompting-guide.md) | Authoring method | Authoring |
| [Story](../../story/cli/NATIVE-FLAGS.md) and [cases](../../vectors/cli/native-flags.json) | Expected outcomes, not observed results | Verification |
| Codex CLI and Claude Code CLI documented usage (installed versions named above) | External evidence for flag names and order | Authoring, verification |

Runtime: JavaScript language facilities only.
