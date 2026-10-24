# Story: only supported `pdd` command lines start work

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who runs `pdd` in a terminal or from a native agent, I want each command line either admitted as one known command or help, or refused before anything happens, so that a typo, an unsafe name or a flag-like word never starts a conversation, a workflow run or a local read.

The [argument parser prompt](../../prompts/cli/argument-parser.prompt.md) owns this policy. The [command catalog](../../prompts/cli/command-catalog.prompt.md) owns the list of routes and their declarations. Preserve the exports `parseArgv(argv)` and `CommandInputError`, the plan fields, the set of admitted and refused argv, and the absence of effects.

Out of scope: help text and dispatch (the [CLI](../../prompts/cli/pdd-cli.prompt.md)), which workflow definitions exist (the [definition loader](../../prompts/cli/workflow-definition-loader.prompt.md)), whether an issue or saved run exists (the [workflow runner](../../prompts/cli/workflow-runner.prompt.md)), and shell completion.

## Observable acceptance criteria

- **AC1:** A catalogued command with valid arguments returns a command plan. Its `commandId` and `local` come from the matched route, `operands` keep input order, supplied options appear under their declared names, and omitted options have no key. Recipe shortcuts carry `workflowName`. Words that start no catalogued route refuse.
- **AC2:** Root help, group help and command help return a help plan with the `helpPrefix` that the prompt's help rules give, for both the `help TOPIC` form and a trailing help flag.
- **AC3:** Help never hides bad input. An unknown topic, a topic with extra words, and invalid or incomplete arguments before a help flag all refuse.
- **AC4:** `workflow run`, `workflow resume` and `workflow attach` admit operands only in the syntax that the prompt's operand type table gives. A custom safe NAME is admitted for `workflow run` but not as a recipe shortcut. An omitted `--decision` stays absent.
- **AC5:** Undeclared, repeated or `=`-joined options refuse, and a value option admits only a declared choice.
- **AC6:** On the session and recipe shortcut routes, the first `--` ends options and later words become request text. Elsewhere `--` refuses. A native agent flag before `--` refuses.
- **AC7:** Every refusal is a `CommandInputError` with `exitCode` 2. Its message names no part of the input. A non-array, a non-string word or a NUL character refuses.
- **AC8:** The returned plan and its arrays and objects are frozen, and the caller's array is unchanged after the call.

## Cases and evidence

The [expected cases](../../vectors/cli/argument-parser.json) map argv inputs to these criteria. They were written from the prompt, not from running the parser.

Existing tests that exercise these criteria, as evidence only:

- [`test/cli.test.mjs`](../../test/cli.test.mjs): `ALPHA1` (AC1, AC2, AC3, AC5, AC7, AC8), `ALPHA4` and `ALPHA6` (AC1, AC3, AC6), `ALPHA7` and `ALPHA8` (AC4, AC5).
- [`test/cli-editable-routing.test.mjs`](../../test/cli-editable-routing.test.mjs): custom NAME and unsafe NAME (AC4), `workflow attach` options and run ID (AC4, AC5).
- [`test/cli-preview-help.test.mjs`](../../test/cli-preview-help.test.mjs): help for root and for `workflow run|resume|attach`, and refused unknown command with help (AC2, AC3).

No test checks incomplete arguments before a help flag (AC3), `--` on a non-session route (AC6), uppercase run IDs (AC4), the message content (AC7) or frozenness (AC8). Passing a finite set of cases is evidence, not proof over all argv.
