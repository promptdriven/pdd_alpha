# Stories for the CLI modules

PDD Alpha uses its own method on itself. Each module in `src/` and `bin/` has one canonical prompt in [`prompts/cli/`](../../prompts/cli/). Each prompt here has a Story with observable acceptance criteria and a file of independent expected cases. The layout follows the [ticket-status example](../../examples/ticket-status/README.md): prompt, Story, then cases.

All Stories and cases are drafts until a person accepts them. Read the whole [Prompting guide](../../docs/prompting-guide.md) before you change any of them.

| Module | Prompt | Story | Cases |
| --- | --- | --- | --- |
| `bin/pdd.mjs` | [bin entry](../../prompts/cli/bin-entry.prompt.md) | [PDD CLI](PDD-CLI.md) | [pdd-cli](../../vectors/cli/pdd-cli.json) |
| `src/pdd-cli.mjs` | [CLI dispatch](../../prompts/cli/pdd-cli.prompt.md) | [PDD CLI](PDD-CLI.md) | [pdd-cli](../../vectors/cli/pdd-cli.json) |
| `src/command-catalog.mjs` | [command catalog](../../prompts/cli/command-catalog.prompt.md) | [command catalog](COMMAND-CATALOG.md) | [command-catalog](../../vectors/cli/command-catalog.json) |
| `src/argument-parser.mjs` | [argument parser](../../prompts/cli/argument-parser.prompt.md) | [argument parser](ARGUMENT-PARSER.md) | [argument-parser](../../vectors/cli/argument-parser.json) |
| `src/completion.mjs` | [completion](../../prompts/cli/completion.prompt.md) | [completion](COMPLETION.md) | [completion](../../vectors/cli/completion.json) |
| `src/guidance.mjs` | [guidance](../../prompts/cli/guidance.prompt.md) | [guidance](GUIDANCE.md) | [guidance](../../vectors/cli/guidance.json) |
| `src/native-session.mjs` | [native session](../../prompts/cli/native-session.prompt.md) | [native session](NATIVE-SESSION.md) | [native-session](../../vectors/cli/native-session.json) |
| `src/workflow-list.mjs` | [workflow list](../../prompts/cli/workflow-list.prompt.md) | [workflow list](WORKFLOW-LIST.md) | [workflow-list](../../vectors/cli/workflow-list.json) |
| `src/workflow-definition-loader.mjs` | [definition loader](../../prompts/cli/workflow-definition-loader.prompt.md) | [definition loader](WORKFLOW-DEFINITION-LOADER.md) | [workflow-definition-loader](../../vectors/cli/workflow-definition-loader.json) |
| `src/workflow-definitions.mjs` | [stage definitions](../../prompts/cli/workflow-definitions.prompt.md) | [stage definitions](WORKFLOW-DEFINITIONS.md) | [workflow-definitions](../../vectors/cli/workflow-definitions.json) |
| `.pdd/workflows/*/` | [bundled workflows](../../prompts/cli/bundled-workflows.prompt.md) | [bundled workflows](BUNDLED-WORKFLOWS.md) | [bundled-workflows](../../vectors/cli/bundled-workflows.json) |
| `src/workflow-runner.mjs` | [workflow runner](../../prompts/cli/workflow-runner.prompt.md) | [workflow runner](WORKFLOW-RUNNER.md) | [workflow-runner](../../vectors/cli/workflow-runner.json) |
| `src/workflow-artifacts.mjs` | [handoff artifacts](../../prompts/cli/workflow-artifacts.prompt.md) | [handoff artifacts](WORKFLOW-ARTIFACTS.md) | [workflow-artifacts](../../vectors/cli/workflow-artifacts.json) |
| `src/workflow-worktree.mjs` | [issue worktrees](../../prompts/cli/workflow-worktree.prompt.md) | [issue worktrees](WORKFLOW-WORKTREE.md) | [workflow-worktree](../../vectors/cli/workflow-worktree.json) |
| `src/workflow-github.mjs` | [GitHub effects](../../prompts/cli/workflow-github.prompt.md) | [GitHub effects](WORKFLOW-GITHUB.md) | [workflow-github](../../vectors/cli/workflow-github.json) |
| `src/workflow-stage-herdr.mjs` | [background stages](../../prompts/cli/workflow-stage-herdr.prompt.md) | [background stages](WORKFLOW-STAGE-HERDR.md) | [workflow-stage-herdr](../../vectors/cli/workflow-stage-herdr.json) |
| `package.json`, CI | [public boundary](../../prompts/cli/public-boundary.prompt.md) | [public boundary](PUBLIC-BOUNDARY.md) | [public-boundary](../../vectors/cli/public-boundary.json) |

The [case format](../../vectors/cli/README.md) explains the fields of each cases file. No test in `test/` reads these cases yet. The existing tests in `test/` are evidence for the criteria. They are not generated from these files.
