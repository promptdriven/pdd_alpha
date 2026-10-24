# Story: a small, predictable public package

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who installs PDD Alpha, I want the package to hold only local commands, to run no code at install time and to report every result with clear exit codes and streams. Then I can trust what it does on my machine and use it from scripts. As a maintainer of a CLI module, I want one owner for that shared policy, so that each module prompt links it and states only its local consequence.

The owning prompt is the [public boundary](../../prompts/cli/public-boundary.prompt.md). This Story preserves its command scope, its full-access decision, its exit-code, stream and effect rules, and the package manifest, lock file and CI facts that it owns. Out of scope: the exact route list ([command catalog](../../prompts/cli/command-catalog.prompt.md)), the exact launch flags ([native session](../../prompts/cli/native-session.prompt.md) and [workflow stage transport](../../prompts/cli/workflow-stage-herdr.prompt.md)), and run states, decisions and PR effects ([workflow runner](../../prompts/cli/workflow-runner.prompt.md)).

## Observable acceptance criteria

- **AC1:** Under the prompt's refusal rule and parse-first rule, an unknown or excluded command, or a catalogued command with invalid words, exits with code 2, with or without a help flag. stdout is empty and stderr has a diagnostic. No guidance, metadata or project file is read, and no native agent, runner, child process or network call starts.
- **AC2:** Under the discovery effects rule, help, `--version`, `--skill`, `workflow list [--json]` and `completion bash|zsh` exit with code 0. The value is on stdout and stderr is empty. No file appears or changes in the project or HOME, and no child process or network call starts. `--version` prints `pdd` and the `package.json` version.
- **AC3:** When package guidance or version metadata is missing or unreadable, or project workflow definitions are invalid, the command exits with code 1. stdout is empty, stderr has a diagnostic, and no native agent starts.
- **AC4:** Under the no-echo rule, a diagnostic for refused input does not contain the rejected words.
- **AC5:** Under the native pass-through rule, a session or recipe shortcut returns the native agent's own exit code. A missing native agent gives 127 with empty stdout. A signal exit gives 128 plus the signal number, for example 130 for `SIGINT`.
- **AC6:** A runner command prints the runner's reply message once on stdout. It exits with 0 for `completed`, 2 for `waiting`, and 1 for `failed` or `recovery_required`. A reply that cannot be confirmed gives 1, a stderr diagnostic, empty stdout and no second runner call.
- **AC7:** Under the full-access decision, a session starts the native agent once in full-access mode, as the native session prompt defines. The cwd, environment and stdin are the person's own. No global native configuration, trust entry or file in HOME or the project is written. Request text, including shell metacharacters and flag-like words after `--`, reaches the agent as text. It is not run by a shell and is not passed as a native flag.
- **AC8:** `package.json` and `package-lock.json` show every fact in the prompt's manifest rules: bin `pdd`, the exact `files` set, engines, `private: true`, the `test` script, no lifecycle script and no dependency field. The lock file root matches the manifest.
- **AC9:** The packed archive contains the CLI, the guide, the skill, the bundled recipes with their `workflow.json` files and the example. It contains no `test/` or `.github/` path. Installing it into a clean folder with scripts off and no network gives a working `pdd` command.
- **AC10:** The CI workflow runs on pull requests, pushes to `main` and manual dispatch, with read-only contents permission. Before `npm ci --ignore-scripts`, a step checks `bash` and makes `zsh` available, as the rule "Shell test prerequisites" says. Then it runs the prompt's four commands in order, with `npm ci --ignore-scripts` first.

## Cases and evidence

The independently authored [expected cases](../../vectors/cli/public-boundary.json) map inputs to these criteria. They are drafts and no test reads them yet.

These existing tests exercise the criteria. They are evidence only; this Story does not claim that they ran.

- AC1: `test/cli.test.mjs` (ALPHA1, ALPHA4, ALPHA6, ALPHA8), `test/cli-preview-help.test.mjs`, `test/cli-editable-routing.test.mjs`.
- AC2: `test/cli.test.mjs` (ALPHA2, ALPHA4), `test/cli-preview-help.test.mjs`.
- AC3: `test/cli.test.mjs` (ALPHA2, ALPHA4), `test/cli-editable-routing.test.mjs`. No test covers unreadable version metadata.
- AC4: no test checks diagnostics against the rejected words.
- AC5: `test/cli.test.mjs` (ALPHA4, ALPHA5), `test/cli-full-access.test.mjs`.
- AC6: `test/cli.test.mjs` (ALPHA7, ALPHA8), `test/cli-editable-routing.test.mjs`.
- AC7: `test/cli-full-access.test.mjs`, `test/cli.test.mjs` (ALPHA4, ALPHA5, ALPHA6), `test/cli-installed-entry.test.mjs`.
- AC8: no test reads the manifest fields or the lock file. ALPHA4 in `test/cli.test.mjs` uses the manifest name and version only.
- AC9: `test/cli.test.mjs` (ALPHA4), `test/cli-installed-entry.test.mjs`.
- AC10: no test. The evidence is the CI workflow file and its results on GitHub.

Passing these finite cases is evidence, not proof over all inputs.

## Open questions

- The `files` allowlist leaves out `story/` and `vectors/`. Should the package ship them next to `prompts/cli/`?
