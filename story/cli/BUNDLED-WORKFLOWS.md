# Story: three ready workflows that a run and a conversation both follow

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who uses PDD, I want ready `feature`, `bug` and `small-change` workflows, so that I can run one on a GitHub issue or follow it by hand in one conversation, and get the same steps and the same instructions both ways. As a maintainer, I want the stage graphs and the duties of each recipe file written down, so that an edit cannot silently break saved runs, the docs or the runner.

The [owning prompt](../../prompts/cli/bundled-workflows.prompt.md) holds the rules. This Story makes them observable. It preserves the current bundled files: the three names, the file names, and each stage's id, order, kind and semantic fields. Recipe wording may change when each file keeps its obligations.

Out of scope: the definition schema and validation (the [definition loader](../../prompts/cli/workflow-definition-loader.prompt.md)), how the runner executes each stage (the [workflow runner](../../prompts/cli/workflow-runner.prompt.md)), the `WORKFLOW_STAGES` export (the [workflow definitions](../../prompts/cli/workflow-definitions.prompt.md)), project workflow folders and the user docs.

## Observable acceptance criteria

- **AC1:** Each bundled folder holds exactly `workflow.json`, `WORKFLOW.md` and one `<stage id>.md` file per stage. Each `workflow.json` has `version` 1, a `name` equal to its folder name and `overview` `WORKFLOW.md`, and each stage `file` is its id plus `.md`.
- **AC2:** The definition loader accepts each bundled definition. In a project with no `.pdd/workflows` folder, `pdd workflow list --json` lists `bug`, `feature` and `small-change`, each with source `bundled`, and exits with code 0.
- **AC3:** The feature stages have the ids, order, kinds and fields in the prompt's feature and bug table, feature column.
- **AC4:** The bug stages have the ids, order, kinds and fields in the same table, bug column. Its stages 2 to 11 equal feature stages 3 to 12.
- **AC5:** The small-change stages have the ids, order, kinds and fields in the prompt's small-change table. It has no human stage and no `requiresMerge`.
- **AC6:** The stage counts are 12, 11 and 5. The agent stage counts are 7, 6 and 3. The mandatory agent stage counts are 5, 5 and 3.
- **AC7:** In a feature or bug run at `prompt-pr`, the outcomes follow the prompt's optional prompt PR table. A skip records `prompt-pr` and `prompt-merge` as skipped, with no push and no PR for them, and the run goes on to `build`. An approve creates one PR and the run waits at `prompt-merge`. After that merge, `build` starts no agent until an explicit approve on a branch that contains the merged commit.
- **AC8:** A small-change run waits with exit code 2 at `change` after `scope`, with only the `scope` agent launched, until an explicit approve.
- **AC9:** Each `WORKFLOW.md` carries the prompt's seven overview items in order. Its numbered step list links every stage file in stage order, and its guide-first item links the Prompting guide.
- **AC10:** The guide-first, runner-branch, runner-PR and runner-merge paragraphs appear in exactly the files that the prompt lists for each.
- **AC11:** No recipe file tells a runner-stage agent to push or to create or merge a PR. No recipe file tells anyone to merge or enable automatic merge. No recipe names a PDD Try, check or approval command or a private service. Every relative link in the recipe Markdown resolves inside the package.

## Cases and evidence

The independent [expected cases](../../vectors/cli/bundled-workflows.json) map file reads, loader calls and run events to these criteria. They were written from the prompt, not from running the code.

Existing tests are evidence for some criteria. This Story does not claim that they ran.

- [`test/workflow-runner.test.mjs`](../../test/workflow-runner.test.mjs): the listed-workflow-totals test covers AC6. The small-change scope-pinning test covers AC5 and AC8. The feature optional-skip test covers AC3 and the skip half of AC7. The separate-prompt-PR test and the saved-optional-skip test cover the rest of AC7.
- [`test/cli.test.mjs`](../../test/cli.test.mjs): the packed-package test covers AC2 and part of AC1 (the three `WORKFLOW.md` files and the feature `workflow.json` ship, and the session and shortcut payloads carry the recipe Markdown). The direct-workflow test checks that a shortcut carries the selected `WORKFLOW.md`.

No existing test checks the bug fields one by one, the exact folder contents, the required roles and approvals, or AC9 to AC11. Passing these finite cases is evidence, not proof that every recipe sentence meets its obligation.

## Open questions

- Small-change `scope.md` writes the `cases` files but does not carry the runner-branch paragraph; `change.md` commits the work later. Should `scope.md` carry it too?
- Each `WORKFLOW.md` says that the runner "supplies only the current stage request plus prior artifact pointers". The runner also sends the full guide-first context and every file of the selected workflow. Should that sentence change?
- `wait-merge.md` keeps the sentence about a separate prompt PR, but small-change has no prompt PR. Keep it for one shared merge paragraph, or drop it?
