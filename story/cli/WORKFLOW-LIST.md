# Story: the workflow list shows the real catalog and starts no work

Draft for review. A person has not accepted it yet.

## Request and scope

As a person or a shell completion script that runs `pdd workflow list [--json]`, I want the workflow catalog printed faithfully, so that completion can read the names as data and a person knows that listing started nothing and how to run a definition. As a legacy caller of `listLocalWorkflows`, I want the project's manual Markdown recipes found without following symbolic links, and without any claim that they can run. The owning prompt is [workflow list](../../prompts/cli/workflow-list.prompt.md).

Preserved: both exports and their synchronous module-function binding, the catalog shapes, JSON fidelity, the facts in human output, and the legacy discovery rules and errors.

Out of scope: how the CLI builds the catalog from the definition loader, the exit code and error text of `workflow list`, completion's name filter, and exact human wording.

## Observable acceptance criteria

- **AC1:** With `json` set, `formatLocalWorkflows` returns text that parses as JSON and deep-equals the supplied catalog: the same fields, the same entry order and `default: null`.
- **AC2:** Without `json`, the output has one line per entry in the supplied order. Each line shows the entry name and its `file`, or its `source` when it has no `file`.
- **AC3:** Without `json`, an empty list gives one line that says no workflow definitions were found. Every human output ends with one line that says listing starts no work and names `pdd workflow run NAME ISSUE`. No exact wording is required.
- **AC4:** The formatter's result has no trailing newline, and the formatter has no filesystem or process effect.
- **AC5:** `listLocalWorkflows` returns `{ workflows: [{ name, file }], default: null }` for project recipe folders that pass the prompt's listed-recipe rule, sorted by name, with `file` relative to `cwd`.
- **AC6:** It returns the empty catalog when `.pdd` or `.pdd/workflows` is missing, is not a directory or is a symbolic link.
- **AC7:** It skips a symbolic-link recipe folder, a missing `WORKFLOW.md`, a `WORKFLOW.md` that is a symbolic link or a folder, and a folder name outside the legacy name rule.
- **AC8:** A filesystem error other than "missing" or "not a directory" reaches the caller as an error. No partial catalog is returned.
- **AC9:** Legacy discovery creates no file, reads no recipe content and sets no default. A folder that it lists does not become a runnable definition: `pdd workflow list` does not fall back to legacy Markdown discovery.

## Cases and evidence

The independent [expected cases](../../vectors/cli/workflow-list.json) map to these criteria. Expected values come from the prompt, not from running the implementation.

Existing tests are evidence only:

- AC1: [test/cli-editable-routing.test.mjs](../../test/cli-editable-routing.test.mjs), "workflow list delegates once to authoritative definition discovery", through `runPdd`. The same file's completion test reads this JSON as data.
- AC1, AC2, AC3: [test/cli.test.mjs](../../test/cli.test.mjs), "ALPHA4: actual packed package runs every advertised local command", checks JSON names, `default: null` and the human notice.
- AC5, AC6, AC7: [test/cli.test.mjs](../../test/cli.test.mjs), "ALPHA3: project listing is sorted, empty when absent and never traverses symlinks", covers the absent folder, sorting and a symbolic-link recipe folder.
- AC4, AC8 and AC9 have no direct test today. AC7 is covered only for a symbolic-link folder.

Passing these finite cases is not proof that the module is correct for every catalog or filesystem state.

## Open questions

- No module in `src/` calls `listLocalWorkflows`; only a test does. Should it stay as a public legacy export, or can a later change remove it?
- The ALPHA4 test requires the exact phrase `Listing starts no work.` in human output. The prompt promises only the fact. Should that phrase become a public contract, or should the test check the fact more loosely?
