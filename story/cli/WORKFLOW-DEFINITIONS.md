# Story: callers read the bundled stage lists from the definition files

Draft for review. A person has not accepted it yet.

## Request and scope

As a maintainer or a test that imports `WORKFLOW_STAGES`, I want the stage lists of the three bundled workflow definitions in one frozen object that comes from the bundled `workflow.json` files, so that no second stage list can drift from those files and no caller can change it. The owning prompt is [workflow stage definitions](../../prompts/cli/workflow-definitions.prompt.md).

Preserved: the constant's name and binding kind, its re-export from the runner, its three keys and their order, the loader's stage entries unchanged, deep frozenness, import failure for an invalid bundled definition, and no limit on runtime name selection.

Out of scope: what the bundled definitions contain (owned by [bundled workflows](../../prompts/cli/bundled-workflows.prompt.md)), the loader's validation rules, and how the runner selects and advances stages.

## Observable acceptance criteria

- **AC1:** `WORKFLOW_STAGES` imported from `src/workflow-definitions.mjs` and from `src/workflow-runner.mjs` is the same object. Its own keys are exactly `feature`, `bug` and `small-change`, in that order.
- **AC2:** Each value deep-equals the `stages` that the definition loader returns for that bundled name, with the package root as both roots. Entries keep definition order and the loader's normalized fields, as the prompt's export shape rule says.
- **AC3:** A `.pdd/workflows/<name>` folder in the caller's working directory does not change the export.
- **AC4:** The object, each array, each entry and each `requiredRoles` array are frozen. A strict-mode write throws `TypeError` and changes nothing.
- **AC5:** When a bundled definition is missing or invalid, importing the module (and the runner) fails with an error. No partial, empty or hardcoded export appears.
- **AC6:** The export does not limit selection. A valid project definition with another name is listed and accepted by the runner, although that name is not a key of `WORKFLOW_STAGES`.
- **AC7:** Importing the module writes no file and starts no child process, Git, GitHub or network work.

## Cases and evidence

The independent [expected cases](../../vectors/cli/workflow-definitions.json) map to these criteria. Expected values come from the prompt and the [bundled workflows](../../prompts/cli/bundled-workflows.prompt.md) contract, not from running the implementation.

Existing tests are evidence only:

- AC1, AC2: [test/workflow-runner.test.mjs](../../test/workflow-runner.test.mjs), "listed workflow totals distinguish native stages from human, optional and PR steps". It imports the constant from the runner and checks stage counts.
- AC4: [test/workflow-definition-loader.test.mjs](../../test/workflow-definition-loader.test.mjs), "snapshot bytes and digest remain immutable", checks freezing at the loader level only.
- AC6: [test/cli-editable-routing.test.mjs](../../test/cli-editable-routing.test.mjs), "editable free NAME reaches one real runner interface", and the loader test "arbitrary safe names and renamed semantic stages load without a PDD code change".
- AC3, AC5 and AC7 have no direct test today.

Passing these finite cases is not proof that the module is correct for every package state.

## Open questions

- Inside this repository, only a test reads `WORKFLOW_STAGES`; the runner only re-exports it. Should the export stay as a public compatibility promise, or can a later change retire it?
