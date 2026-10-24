# Bundled workflows

Owns the bundled workflow definitions `.pdd/workflows/<name>/workflow.json` and their recipe Markdown. The bundled names are `feature`, `bug` and `small-change`. These are package data files with no code exports.

Each folder gives a project a ready workflow, and the same files serve two uses. As a **workflow definition**, `workflow.json` sets the stages that `pdd workflow run` executes. As a **recipe**, `WORKFLOW.md` and the step files say what each step must achieve. The recipe is the manual guidance in one conversation (`pdd session`, a recipe shortcut or a chat opened by hand), and it is the instruction text of each runner stage.

Inputs: none at runtime. The [definition loader](workflow-definition-loader.prompt.md) reads and validates the definitions for `workflow run`, `resume`, `list` and the `WORKFLOW_STAGES` export. [Guidance](guidance.prompt.md) loads every recipe Markdown file into `pdd session`, and the selected recipe into a recipe shortcut. The [workflow runner](workflow-runner.prompt.md) saves the selected files and sends them with each agent stage request.

Outcomes: each folder holds one valid version-1 definition with the [stage graph](#stage-graphs) below, and exactly its declared Markdown with the [recipe content](#recipe-markdown) below.

Preservation: behavioral refinement of the current bundled files. Keep the three names, the folder layout and every file name. For each stage, keep its id, order, kind, protocol, optional flag, approval, required roles, publication mode, `prStage` and `requiresMerge`. Saved runs, `WORKFLOW_STAGES`, the docs, the skill and the tests refer to them, so a change to a stage graph needs authorization. Recipe wording may vary when each file keeps its obligations below. Any byte change to these files changes the definition digest, and a run saved with the earlier bytes then refuses to advance (a runner rule).

## Stage graphs

Every `workflow.json` has `version` 1, a `name` equal to its folder name, `overview` `WORKFLOW.md`, and the stages below in this order. Each stage has `id`, `kind` and `file`, and `file` is the stage id plus `.md`. In `workflow.json`, a stage has no fields other than those in its row. A stage without `optional` is mandatory. The loader owns the meaning of each field.

### Feature and bug

The bug definition starts with `reproduce` in place of the feature stages `understand` and `visual`. Shared stages have the same fields in both.

| Stage | Kind | Other fields | Feature step | Bug step |
| --- | --- | --- | ---: | ---: |
| `reproduce` | agent | protocol `report` | — | 1 |
| `understand` | agent | protocol `report` | 1 | — |
| `visual` | agent | protocol `report`; optional | 2 | — |
| `prompt-story` | agent | protocol `proposal`; required roles `prompt`, `story`, `cases`; approval `human` | 3 | 2 |
| `check` | agent | protocol `report` | 4 | 3 |
| `try` | agent | protocol `report`; optional | 5 | 4 |
| `approve` | human | none | 6 | 5 |
| `prompt-pr` | pr | publication `proposal`; optional | 7 | 6 |
| `prompt-merge` | merge | `prStage` `prompt-pr` | 8 | 7 |
| `build` | agent | protocol `work`; `requiresMerge` `prompt-merge` | 9 | 8 |
| `verify` | agent | protocol `verify` | 10 | 9 |
| `code-pr` | pr | publication `verified`; `requiresMerge` `prompt-merge` | 11 | 10 |
| `code-merge` | merge | `prStage` `code-pr` | 12 | 11 |

Feature has 12 steps and 7 agent stages, 5 of them mandatory. Bug has 11 steps and 6 agent stages, 5 of them mandatory.

### Small change

| Step | Stage | Kind | Other fields |
| ---: | --- | --- | --- |
| 1 | `scope` | agent | protocol `proposal`; required roles `cases`; approval `next-advance` |
| 2 | `change` | agent | protocol `work` |
| 3 | `verify` | agent | protocol `verify` |
| 4 | `open-pr` | pr | publication `verified` |
| 5 | `wait-merge` | merge | `prStage` `open-pr` |

Small-change has 5 steps and 3 agent stages, all mandatory. In every workflow, a skipped optional step stays listed, and human, PR and merge steps start no agent.

### Why the graphs have this shape

- **One proposal.** It supplies the contract files and the native test plan that `verify` runs. Feature and bug change a module contract, so they require `prompt`, `story` and `cases`. A small edit needs no new Story or prompt, so small-change requires only `cases`.
- **Approval after review.** In feature and bug, the human `approve` stage comes after `check` and `try`, so the person approves with the review results in view. Small-change has no review stage. Its `next-advance` approval still pauses the run before `change` until an explicit approve.
- **Optional only where a step may not apply.** `visual` needs a UI, `try` needs a project preview, and `prompt-pr` needs a request for a separate prompt review.
- **Verified code PR.** `verify` follows the last work stage, so `code-pr` and `open-pr` publish as `verified`. `prompt-pr` publishes as `proposal`, because it carries the accepted contract before code exists.
- **One merge stage per PR.** It observes GitHub and never merges.

## Optional prompt PR

This applies to feature and bug. The person decides at `prompt-pr`. `prompt-merge` is not optional itself; it follows the decision about the PR that it names. `build` and `code-pr` name `prompt-merge` in `requiresMerge`. The [runner](workflow-runner.prompt.md) owns the exact decision, merge and branch rules.

| Stage | Prompt PR approved | Prompt PR skipped |
| --- | --- | --- |
| `prompt-pr` | The runner opens a real PR with the accepted prompt, Story and cases. | Recorded as skipped. No push and no PR. |
| `prompt-merge` | The run waits until that exact PR merges. | Skipped with `prompt-pr`. |
| `build` | Starts only after an explicit approve, on a branch that contains the merged prompt commit. | No merge condition. |
| `code-pr` | Publishes only from a branch that contains that merged commit. | No merge condition. |

## Recipe Markdown

**Folder contents.** Each folder holds exactly `workflow.json`, `WORKFLOW.md` and one `<stage id>.md` file for each stage. Reason: `pdd session` and the recipe shortcut load every Markdown file in the folder, but a run loads only the declared files. An extra file would reach manual conversations and never reach runs. Step links in `WORKFLOW.md` are plain file names in the same folder.

**Both uses.** Every file must read correctly in manual use and as a runner stage. In manual use, one conversation follows the steps in order and publishes nothing unless the person asks. It never merges, never enables automatic merge, and never claims a merge or a publication because the recipe ended. In a run, a fresh agent does only the current stage, and the runner does every push, PR and merge observation.

**Honest evidence.** A recipe names no PDD Try, check or approval command, no phone approval and no private service. It asks for reports of only what really ran: commands, exit status, revision, results and gaps. A native test is not prompt execution or formal proof. Expected cases come from the requirements, never from implementation output, and are not rewritten to match code.

### Overview file

Each `WORKFLOW.md` carries these items, in this order:

1. **When to use.** Feature: new behavior with a prompt contract and implementation. Bug: observed behavior that violates an accepted expectation. Small-change: a contained, reversible change with a clear effect and limited impact.
2. **Two ways to use it.** By hand in the person's existing conversation, or with `pdd workflow run NAME ISSUE`. Describe the runner briefly: a fresh agent conversation for each agent step, recorded human choices, real PR stages through normal Git and GitHub tools, no private service and no merge.
3. **Current stage only.** A runner-launched agent follows only the current-stage request and handoff protocol; the overview authorizes no later step. It completes the real stage files and the closed handoff, reports, and stops without a manual native exit. It never pushes, creates a PR, ends the controller or launches a later stage. Say that only the controller's own checks of the handoff, files and tests certify a stage, that a stopped controller needs an explicit resume, and that `pdd workflow attach RUN_ID` attaches the active stage.
4. **Guide first.** Before any Story, read the whole Prompting guide into the conversation, also in an existing chat. Summarize the relevant method: describe what and why, preserve observable behavior and consequential edge cases, give each rule one owner, and keep expected results independent of implementation. Then apply it. A link, a file name, an earlier summary or a format check does not load the guide. If it is unavailable, ask for its contents before drafting.
5. **Step list.** One numbered link to each stage file, in stage order.
6. **Scope note.** Feature: the separate prompt PR is optional; prompt, Story, cases and code may share one reviewed change; when the existing prompt already covers the request, say so, keep it, and ask for no extra approval. Bug: when the prompt already specifies the expected behavior, keep it and say that the defect is in the implementation. Small-change: no new Story or broad prompt adoption is needed; update an owning prompt first when its behavior changes; if impact or rollback is unclear, propose the feature or bug recipe.
7. **Editable definition.** To edit a workflow or add one, copy the complete folder to the project's `.pdd/workflows/NAME/`. A project folder replaces the whole bundled recipe and must hold a valid definition and every declared file. `pdd workflow list` shows the valid definitions. A run saves its definition, Markdown and guide-first context before it starts, so edits apply only to new runs. Test commands come from the accepted proposal handoff, not from the JSON.

### Shared step paragraphs

These paragraphs repeat so that each step file is complete when an agent follows only that step. Keep the same meaning in every file listed. The runner paragraphs describe the [runner](workflow-runner.prompt.md); they must agree with it and add no rule.

- **Guide first**, in feature `understand.md`, every `prompt-story.md` and small-change `scope.md`: overview item 4.
- **Runner branch**, in every `prompt-story.md` and `build.md`, and small-change `change.md`: under the runner, follow the exact handoff request and commit only the agreed work on the intended topic branch before a later PR stage. Never force a checkout, reset, stash or overwrite unrelated work. If a safe committed branch is not possible, report that limit and do not push or create a PR.
- **Runner PR**, in every `pr` step file: in a run, the runner itself pushes and creates the PR, and starting the run authorizes that effect; the optional prompt PR still needs its recorded choice. The agent never publishes a duplicate. The runner needs a clean committed topic branch and reconciles an uncertain delivery instead of repeating it.
- **Runner merge**, in every `merge` step file: on resume, the runner observes the exact recorded PR and advances only after a real merge. It never merges, and a resume without a decision starts no new effect. After a separate prompt PR merges, code work starts from a base that contains the accepted prompt revision, without rewriting existing work.

<details>
<summary><strong>Per-step instructions: what each step file must achieve</strong></summary>

In feature and bug, `prompt-pr.md`, `prompt-merge.md`, `code-pr.md` and `code-merge.md` have the same text.

| File | Must achieve |
| --- | --- |
| `understand.md` (feature) | Restate the observable outcome, boundaries, compatibility promise and exclusions, and ask only for decisions that the repository cannot settle. |
| `reproduce.md` (bug) | Record the smallest safe reproduction (setup, input, expected, actual, command), claim no unexecuted run, and keep the failing input for a regression test. |
| `visual.md` (feature) | For a UI, show alternatives that include empty and error states and use the choice in the prompt's appearance contract; without a UI, say so and continue. |
| `prompt-story.md` (feature) | Write the owning prompt first, then a Story with observable criteria and cases authored before any implementation output is used. |
| `prompt-story.md` (bug) | Correct the prompt only when it is wrong, and keep the real bug input with its expected result from the accepted requirement, plus nearby cases. |
| `check.md` | Trace a normal and an edge case (bug: the bug input) through the contract, and check expected values against the requirements, not the code. |
| `try.md` | Offer the project's existing safe preview when it helps, and report only what really ran for this revision. |
| `approve.md` | Show the current contract, cases, open questions and evidence, and use the authorization already given; a passing test is not approval. |
| `prompt-pr.md` | Prepare a separate prompt PR only when the person wants one; otherwise keep these files with the implementation. |
| `prompt-merge.md` | When a separate prompt PR must merge first, follow the repository process; never infer a merge or enable automatic merge. |
| `build.md` (feature) | Implement only the agreed Story from the current prompt, and test it through the public boundary. |
| `build.md` (bug) | Make the smallest fix with a regression test, and explain a broader impact before the scope grows. |
| `verify.md` (feature) | Run the native tests on the independent cases and regressions, and report commands, exit status, revision and untested criteria. |
| `verify.md` (bug) | Show, in disposable copies, that the regression fails on the old behavior when feasible and passes on the fix. |
| `code-pr.md` | Show the diff with the prompt, Story, cases, real test results, limits and a rollback. |
| `code-merge.md` | Leave the merge to the person's process and the repository's checks. |
| `scope.md` (small-change) | State the result, the affected surface, why it is contained and how to undo it, with an independent expected result for a behavior change. |
| `change.md` (small-change) | Change only the agreed scope, update an owning prompt before code, and add a native test for a behavior change. |
| `verify.md` (small-change) | Run focused native tests (link and diff review for a documentation-only edit), and report commands, status, revision, coverage and rollback. |
| `open-pr.md` (small-change) | Show the diff, scope, focused results and rollback; no separate prompt PR is needed. |
| `wait-merge.md` (small-change) | A person decides the merge; rerun the affected checks when feedback changes behavior. |

</details>

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) — authoring and review method for this prompt. Runtime: every recipe tells its reader to read this whole file, and recipe links reach it as `../../../docs/prompting-guide.md`.
- [public boundary](public-boundary.prompt.md#command-scope) — shared command scope and package files (authoring). Local consequence: recipes name only commands in that scope and no excluded one, such as a PDD Runtime Try or CHECK, a private Host or a managed workflow service. The package ships the `.pdd/workflows/` folders, and every recipe link resolves inside a clean extracted package.
- [Definition loader](workflow-definition-loader.prompt.md) — required for authoring, runtime and testing. It owns the version-1 schema, the field meanings, the stage-order rules, project overrides and the definition digest. Every bundled definition must pass it.
- [Workflow runner](workflow-runner.prompt.md) — required for authoring. It owns how each protocol, approval, decision, PR stage and merge stage runs. Recipe text about runner behavior must agree with it.
- Navigation only: [workflow definitions](workflow-definitions.prompt.md) derives `WORKFLOW_STAGES` from these files. [Workflow guidance](../../docs/workflows.md) shows users the stage table, and the [README](../../README.md) and the [skill](../../skills/pdd/SKILL.md) name the three workflows; keep them consistent with this prompt.
