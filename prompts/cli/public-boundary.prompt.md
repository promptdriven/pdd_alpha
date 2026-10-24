# Public boundary

Owns [`package.json`](../../package.json), [`package-lock.json`](../../package-lock.json) and [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). It has no code module and no exports.

PDD Alpha is a local Node package with one command, `pdd`. It gives the person's own coding agent the Prompting guide, the PDD skill, the bundled recipes and an example, and it contains a local issue runner. This prompt owns two shared policies that the other CLI prompts link to: [command scope](#command-scope) and [exit codes and output](#exit-codes-and-output). It also owns the package manifest, the lock file and the CI workflow, because no code module owns them. A prompt that follows a shared policy links its section and states only its local consequence.

There is no runtime input. npm reads the manifest and the lock file, and GitHub Actions runs the CI workflow. Outcomes: the package installs with no dependencies and runs no code at install time; only local commands exist; every command uses the same exit codes and streams.

Preservation: behavioral refinement. Keep the exclusions, the full-access decision, the exit-code meanings, the stream and effect rules, and every package and CI fact below. JSON key order and formatting, the `description` text, CI step names and action versions may vary.

## Command scope

The [command catalog](command-catalog.prompt.md) owns the exact routes, operands, options and help forms. Help, the parser and completion use only that catalog. The commands form three groups:

- **Local discovery**: help, `--version`, `--skill`, `workflow list [--json]` and `completion bash|zsh`. The **discovery effects** rule below limits them.
- **Foreground native conversations**: `session` and the recipe shortcuts `workflow feature|bug|small-change`. Each starts the native agent once, in the person's terminal and cwd. A recipe shortcut is one conversation, not the runner, and opens no PR by itself.
- **Local issue runner**, labeled PREVIEW in help: `workflow run`, `workflow resume` and `workflow attach`. The [workflow runner](workflow-runner.prompt.md) owns runs, decisions and real Git and GitHub effects, through the person's own `git`, `gh` and Herdr. It can push branches and create PRs. It never merges. The CLI only parses and dispatches.

**Excluded.** None of these exist. Source keeps no declaration, validator, import or default for them, even an unused one:

- a private Host, a Host adapter, an installed-Host lookup or any other private import;
- PDD Runtime operations, such as lint, CHECK, Try or replay;
- a private session engine, a managed or remote workflow service, or a background PDD daemon;
- a PDD installer, a setup command or code that runs at install time;
- private authentication, account changes, enrollment or provider gates, and private PDD network calls;
- forwarded argv: the person's words never reach a native agent as native flags.

**Refusal rule.** A command outside the catalog, including an excluded one, gets exit code 2 before any effect. So does a catalogued command with invalid words. A help flag or the `help` word does not change this.

**Accepted product decision: full access.** PDD starts native agents in full-access mode, with no approval prompts, for sessions, recipe shortcuts and runner stages. [Native session](native-session.prompt.md) owns the exact flags for sessions and recipe shortcuts. [Workflow stage transport](workflow-stage-herdr.prompt.md) owns them for runner stages. Full access lasts for one invocation. PDD writes no global native configuration and no trust entry, and it changes no login, provider, model, effort or environment. After a native refusal it does not retry in another permission mode. The native agent keeps the person's cwd, environment and login.

**Supported use.** Run from a source checkout with `node bin/pdd.mjs`, or install from the GitHub repository as the [README](../../README.md#install) shows. Publication to the npm registry is out of scope.

## Exit codes and output

PDD reports its own outcomes with these exit codes. [Native session](native-session.prompt.md) and the [workflow runner](workflow-runner.prompt.md) map their outcomes to them.

| Exit code | Meaning |
| --- | --- |
| 0 | Success, or runner state `completed`. |
| 1 | Failure: missing or unreadable package guidance or version metadata, invalid workflow definitions, a native launch failure other than "not found", runner state `failed` or `recovery_required`, or a runner reply that cannot be confirmed. |
| 2 | Unsupported input, refused before any effect, or runner state `waiting`. |
| 127 | The selected native agent, `codex` or `claude`, is not found. |
| 128 + signal number | The native agent ended by a signal, for example 130 for `SIGINT`. |

**Native pass-through.** After a session or recipe shortcut starts its native agent, `pdd` returns the agent's own exit code unchanged. So a code such as 1 or 2 can come from the agent.

**Parse first.** PDD parses the complete argv before it reads guidance, package metadata or project files, and before any native launch, runner call, or Git, GitHub, Herdr or network effect. Refused input causes none of these. A help flag never hides invalid words.

**Streams.** stdout carries only the requested value: help, the line `pdd <version>`, the guidance bundle, the workflow listing as text or JSON, the completion script, or the runner's final reply message. The CLI prints that message once, in every runner state. The runner owns output that it streams while it works, such as approved test output. stderr carries diagnostics. When PDD itself refuses or fails, stdout stays empty and stderr gets a short diagnostic. Successful discovery writes nothing to stderr. A failure never leaves part of a value on stdout. A native agent uses the inherited terminal directly.

**No echo of untrusted input.** A diagnostic never repeats rejected or unvalidated input: argv words, request text or project file content. It may name validated values, such as the agent name, a run ID or a stage ID. Reason: raw input can hold terminal control characters, secrets or very long text. PDD also never evaluates such text in a shell: every child process starts with an argv array and no shell.

**Discovery effects.** Help, `--version`, `--skill`, `workflow list` and `completion` create, change or delete no file in the project, HOME or the package. They start no child process, call no runner and make no Git, GitHub or network call. They read no credential store, SSH key or `.npmrc`, and they depend on no private folder in HOME. Completion prints a script and does not edit shell configuration. Refused input has the same limits.

## Package manifest and checks

The package has no dependencies and runs no code at install time. npm installs one command, `pdd`, from `bin/pdd.mjs`. The `files` allowlist ships the CLI with the complete guide, skill, recipes and example, so a clean extracted package works without the repository. CI runs the public checks on every pull request and every push to `main`.

<details>
<summary><strong>Required <code>package.json</code> and <code>package-lock.json</code> facts</strong></summary>

In `package.json`:

- `name` is `pdd`, `type` is `module` and `license` is `MIT`.
- `version` is the release version. `pdd --version` prints `pdd <version>` from it. A version change is a release decision.
- `bin` is exactly `{ "pdd": "bin/pdd.mjs" }`. The command name is `pdd`, not `pdd-alpha`.
- `engines` is exactly `{ "node": ">=22.16.0" }`.
- `private` is `true`, which blocks npm registry publication.
- `scripts` has only `test`: `node --test test/*.test.mjs examples/ticket-status/test/*.test.mjs`. `npm test` is the public full suite.
- **No lifecycle scripts.** There is no npm lifecycle script, such as `preinstall`, `install`, `postinstall`, `prepare`, `prepack` or `postpack`. Reason: npm runs them during install, including `prepare` for an install from GitHub, and the alpha runs no code before the person runs `pdd`.
- **Dependency-free.** There is no `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies` or `bundleDependencies` field. The CLI and tests use only Node built-ins.
- **Files allowlist.** `files` is exactly this set, in any order: `README.md`, `LICENSE`, `CONTRIBUTING.md`, `AGENTS.md`, `bin/`, `src/`, `prompts/cli/`, `docs/`, `skills/`, `.pdd/workflows/`, `examples/`. Other paths, such as `test/` and `.github/`, stay out, and npm never packs `package-lock.json`. The package holds every file that `src/` reads at run time. Every link in the guide, the skill and its references, the recipes and the example resolves inside a clean extracted package.

`package-lock.json` has `lockfileVersion` 3, `requires: true` and one `packages` entry, the root `""`. Its `name`, `version`, `license`, `bin` and `engines` equal those in `package.json`. There are no dependency entries. Change it together with `package.json`, because CI installs with `npm ci`.

</details>

<details>
<summary><strong>Required CI checks in <code>.github/workflows/ci.yml</code></strong></summary>

- Triggers: every pull request, every push to `main`, and manual dispatch.
- Permissions: `contents: read` only.
- Concurrency: one group for each workflow and ref. A new run cancels an older one still in progress.
- One job on `ubuntu-latest`, with a 10-minute timeout.
- Steps: check out; set up Node.js 22, a release that satisfies `engines`; then run in order `npm ci --ignore-scripts`, `npm test`, `node bin/pdd.mjs --help` and `npm pack --ignore-scripts --dry-run`. `--ignore-scripts` keeps install and pack from running package scripts. The help step checks that the entry runs from source. The pack step checks the allowlist without writing an archive.
- CI uses no secret, model account, Herdr or GitHub CLI login. The tests need no live service or model call.

</details>

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) — authoring and review method for this prompt.
- [Command catalog](command-catalog.prompt.md) — owner of the exact route list that command scope summarizes. Navigation for review only.
- [Native session](native-session.prompt.md) — owner of the full-access flags for sessions and recipe shortcuts, and of the native exit, 127 and signal mapping. Navigation for review only.
- [Workflow stage transport](workflow-stage-herdr.prompt.md) — owner of the full-access flags for runner stages. Navigation for review only.
- [Workflow runner](workflow-runner.prompt.md) — owner of run effects and of the map from run states to exit codes 0, 2 and 1. Navigation for review only.
- npm (tool; generation, testing) — reads the manifest and lock file. CI runs `npm ci --ignore-scripts`, `npm test` and `npm pack --ignore-scripts --dry-run`.
- Node.js 22.16.0 or newer (runtime, testing) — runs `bin/pdd.mjs` and `node --test`.
- GitHub Actions (testing) — runs the CI workflow with `actions/checkout` and `actions/setup-node`.
