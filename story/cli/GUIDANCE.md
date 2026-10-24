# Story: every agent conversation starts from the complete PDD guidance

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who opens a native agent through PDD, or who gives `pdd --skill` output to an existing conversation, I want the agent to get the complete Prompting guide first, then the skill, its references and the recipes it needs, plus the exact command for this PDD package. Then the agent applies the real method before any Story, and it does not run a different `pdd` installation by mistake.

The [owning prompt](../../prompts/cli/guidance.prompt.md) defines the rules. This Story preserves the `loadGuidance` module function, its load order, complete file text, link refusal, output markers and installed command identity. Out of scope: argument parsing and exit-code mapping in the CLI, how the native session launches the agent, how the runner builds and checks stage context, and the content of the guide and recipes.

## Observable acceptance criteria

- **AC1:** With `workflows` omitted or `false`, the result has sections for the guide, then `SKILL.md`, then every eligible reference file in scan order, nested files included, and no other file. With no references folder, the result has only the guide and skill sections.
- **AC2:** With `workflows: true` and no `workflowName`, the sections continue with `docs/workflows.md` and then every eligible file of every bundled recipe, in scan order. Non-Markdown files have no section, and there is no selected-recipe part.
- **AC3:** With a `workflowName`, the selected-recipe part comes before any file text. The sections continue with `docs/workflows.md`, the selected `WORKFLOW.md`, then the other eligible files of that recipe only. No section of another recipe appears.
- **AC4:** Each result begins with the title line. The package, project, guide-first and authority parts of the prompt's output layout come before any file text. The project part holds `cwd` exactly as given.
- **AC5:** Each result, also with `workflows: false`, holds the command pair (the running Node executable path and the absolute `bin/pdd.mjs` path) as a one-line JSON array and as a shell-quoted prefix. In a POSIX shell whose PATH finds another `pdd`, the prefix with `--help` runs this package, also when the paths hold spaces or single quotes. A package without `bin/pdd.mjs` still loads.
- **AC6:** Each section holds the complete file text, unchanged and not truncated.
- **AC7:** A missing fixed file that the call needs, a missing recipe folder or one without Markdown, or an unknown `workflowName` makes the call throw with no result. Through the CLI this gives exit code 1, empty standard output and no native launch.
- **AC8:** A symbolic link at a fixed file, at a scanned folder or inside a scanned folder makes the call throw. The link is neither followed nor skipped.
- **AC9:** The call writes no file, starts no process, uses no network and includes no file from `cwd`. The same inputs and package files give a byte-identical result. A changed guide byte gives a different result.

## Cases and evidence

The [expected cases](../../vectors/cli/guidance.json) map to these criteria. They come from the prompt, not from program output.

These existing tests exercise the criteria. They are named as evidence only; this Story does not claim that they ran.

- `test/cli.test.mjs`, ALPHA2: guide before skill and nested references; a missing guide gives exit code 1 with no output (AC1, AC6, AC7).
- `test/cli.test.mjs`, ALPHA4 (packed package): `--skill` holds every reference; `session` holds every recipe file and `docs/workflows.md`; each shortcut holds its own recipe and no other recipe's `WORKFLOW.md` section; a missing selected `WORKFLOW.md` or guide gives exit code 1 with no output; commands run under a guard that forbids process and network calls, and the project folder stays empty (AC1, AC2, AC3, AC6, AC7, AC9).
- `test/cli.test.mjs`, ALPHA6: the selected-recipe part and the selected `WORKFLOW.md` text reach the native launch (AC3).
- `test/cli-installed-entry.test.mjs`: argv pair and shell prefix for both `workflows` values, quoted paths, an older `pdd` on PATH, and the guide-first marker (AC4, AC5).
- `test/workflow-runner.test.mjs`: stage calls use `workflows: false`; stage contexts begin with the title line; packages without `bin/` load; a changed guide stops a saved run (AC4, AC5, AC9).

No existing test loads guidance through a symbolic link (AC8). Passing these finite cases is evidence, not proof.

## Open questions

- An absent `skills/pdd/references/` folder is not an error today, while a missing guide or skill is. The CLI error text asks for a package that holds references. Should an absent references folder fail the load?
- No caller passes `workflowName` with `workflows: false`. Today that adds the selected-recipe part but loads no recipe. Should this combination be refused?
