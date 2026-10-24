# Story: one truthful list of public commands

Draft for review. A person has not accepted it yet.

## Request and scope

As a maintainer of the PDD CLI, I want one frozen list of the public commands, so that help, argument parsing and shell completion always agree and no excluded command can appear in any of them. As a user, I want help to mark the workflow runner commands as PREVIEW, so that I do not take them as proven.

The [owning prompt](../../prompts/cli/command-catalog.prompt.md) holds the rules. This Story preserves its four exported constants, the twelve routes in their order, their declarations, the help forms and descriptions, the record shapes and the frozenness.

Out of scope: what each operand type admits ([argument parser](../../prompts/cli/argument-parser.prompt.md)), the shell script text ([completion](../../prompts/cli/completion.prompt.md)), help layout, the preview footer and dispatch ([CLI](../../prompts/cli/pdd-cli.prompt.md)), and the shared command scope and exit codes ([public boundary](../../prompts/cli/public-boundary.prompt.md)).

## Observable acceptance criteria

- **AC1:** Importing `src/command-catalog.mjs` gives exactly the four exports that the prompt names and has no other effect. `PUBLIC_COMMAND_IDS` lists the twelve route IDs in route table order.
- **AC2:** Each route's prefix, `local` disposition, operands and options equal its row in the route table. "None" is an empty array.
- **AC3:** `BUNDLED_WORKFLOW_NAMES` is `feature`, `bug`, `small-change`. Each name has one recipe shortcut route that carries it as `workflowName`. No other route has a `workflowName` key.
- **AC4:** `workflow.run` declares its name operand by the rule "Free workflow name", not as a choice of the bundled names.
- **AC5:** `PUBLIC_COMMAND_MANIFEST` holds the fifteen form records in route order and then form order, as the same records the routes hold. Each form follows the rule "Form prefix".
- **AC6:** The rule "PREVIEW label" holds: exactly the `workflow.run`, `workflow.resume` and `workflow.attach` descriptions carry it.
- **AC7:** Every record has the shape that the prompt gives, with no extra keys and with its absent keys absent. This includes the rule "One choice list per option name".
- **AC8:** The exported arrays and the records that the prompt names are frozen. A write fails and the catalog stays unchanged.
- **AC9:** By the rule "Exact route set", a command outside the route table has no route.

## Cases and evidence

The independent [expected cases](../../vectors/cli/command-catalog.json) map to these criteria. Their expected values come from the prompt, not from running the module.

These existing tests are evidence. This Story does not claim that they ran.

- AC1 and AC9: `test/cli.test.mjs` test ALPHA1 checks the ID order and refuses excluded commands. Test ALPHA4 checks that packed help and completion name no excluded command.
- AC2 and AC4: `test/cli-editable-routing.test.mjs` admits a custom workflow name and refuses options on `workflow attach`. `test/cli.test.mjs` test ALPHA7 checks the run and resume operands.
- AC3: `test/cli.test.mjs` test ALPHA6 checks that a shortcut plan carries its `workflowName`.
- AC5 and AC6: `test/cli-preview-help.test.mjs` checks the PREVIEW descriptions in root, group and exact help, and their absence from `session --help`.
- AC7: `test/cli.test.mjs` test ALPHA4 checks the `--agent` and `--decision` choices through completion.
- AC8, and the record shapes and import effects in AC1 and AC7: no existing test checks them directly.

Passing these finite cases is evidence, not proof.

## Open questions

- Must the `choices` arrays inside option records also be frozen? Today they are not, and the prompt leaves this free.
