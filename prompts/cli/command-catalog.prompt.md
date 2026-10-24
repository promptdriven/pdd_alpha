# Command catalog

Owns `src/command-catalog.mjs`. Exports four frozen array constants: `PUBLIC_COMMAND_ROUTES`, `PUBLIC_COMMAND_IDS`, `PUBLIC_COMMAND_MANIFEST` and `BUNDLED_WORKFLOW_NAMES`. It exports nothing else.

The catalog is the only list of public `pdd` commands. Each route gives one command its ID, its exact leading words (the prefix), its local disposition, its operand and option declarations and its help forms. The [argument parser](argument-parser.prompt.md) admits argv only through these routes. [Completion](completion.prompt.md) builds its command, option and choice suggestions from them. The [CLI](pdd-cli.prompt.md) renders help from the manifest and dispatches on the disposition. [Guidance](guidance.prompt.md) selects a recipe only from `BUNDLED_WORKFLOW_NAMES`. These consumers keep no second command list.

The module takes no input. Importing it reads no file, environment variable or network resource, starts no process and imports no other module.

Preservation: behavioral refinement. Keep the export names and binding kind, the exact route set and order, every declared value, the record shapes with their absent keys, the frozenness and the exact form text. A description may be reworded if it keeps every fact of its current text below. How the module builds the constants may vary.

## Routes

`PUBLIC_COMMAND_ROUTES` holds exactly these twelve routes, in this order. `PUBLIC_COMMAND_IDS` holds their IDs in the same order. "None" means an empty array.

| Order | ID | Prefix | `local` | Operands (`name`: `type`) | Options |
| --- | --- | --- | --- | --- | --- |
| 1 | `workflow.run` | `workflow run` | `workflow-run` | `name`: `workflow-name`, then `issue`: `issue` | `--agent`: `codex`, `claude` |
| 2 | `workflow.resume` | `workflow resume` | `workflow-resume` | `run-id`: `uuid` | `--decision`: `approve`, `skip` |
| 3 | `workflow.attach` | `workflow attach` | `workflow-attach` | `run-id`: `uuid` | none |
| 4 to 6 | `workflow.<name>` | `workflow <name>` | `session` | `request`: `text`, optional, repeated | `--agent`: `codex`, `claude` |
| 7 | `session` | `session` | `session` | `request`: `text`, optional, repeated | `--agent`: `codex`, `claude` |
| 8 | `help` | `help` | `help` | none | none |
| 9 | `version` | `--version` | `version` | none | none |
| 10 | `skill` | `--skill` | `skill` | none | none |
| 11 | `completion` | `completion` | `completion` | `shell`: `choice:bash,zsh` | none |
| 12 | `workflow.list` | `workflow list` | `workflow-list` | none | `--json` flag |

Rows 4 to 6 are the **recipe shortcut** routes, one for each `<name>` in `BUNDLED_WORKFLOW_NAMES`: `feature`, `bug`, `small-change`, in that order. Each also carries `workflowName: <name>`, so the CLI loads only that bundled recipe. No other route has a `workflowName` key.

Operand types are a closed set of tokens: `text`, `workflow-name`, `issue`, `uuid`, and `choice:` followed by comma-separated values. The argument parser owns what each type admits, and also the words after `help`, so the `help` route declares no operands.

- **Exact route set.** A command outside the table has no route. This includes every command that the [public boundary](public-boundary.prompt.md) excludes, a `status` command, and any route that creates a workflow or takes a path.
- **Free workflow name.** `workflow.run` declares `name` as a `workflow-name`, not as a choice of the bundled names. The [definition loader](workflow-definition-loader.prompt.md) decides which definitions exist.
- **No defaults here.** Declarations carry no default value. When `--agent` is absent, the CLI uses `codex`. When `--decision` is absent, the [workflow runner](workflow-runner.prompt.md) only inspects and reconciles.

## Help forms

Each route has one help form, except `help`, which has four. `PUBLIC_COMMAND_MANIFEST` holds all fifteen form records in route order and then form order. They are the same records as in the routes' `forms` arrays. Root help lists them in this order.

- **Form prefix.** Every form starts with `pdd`. Except on the `help` route, the words after `pdd` begin with the route's prefix words. Reason: help for a command shows the forms whose leading words match the requested prefix.
- **No preview label.** No description contains `PREVIEW` or says that a real workflow PR is not yet proven. Accepted product decision: the runner commands are published without a release label. This adds no gate or success claim, and the `workflow.run` description keeps its warning about real pushes and PRs.

<details>
<summary><strong>Exact help forms and descriptions</strong></summary>

| Route | Form | Description |
| --- | --- | --- |
| `workflow.run` | `pdd workflow run NAME ISSUE [--agent codex\|claude]` | `Run a validated project or bundled workflow for a GitHub issue; may push branches and create real PRs.` |
| `workflow.resume` | `pdd workflow resume RUN_ID [--decision approve\|skip]` | `Inspect or continue a saved workflow; omitted decision only reads/reconciles.` |
| `workflow.attach` | `pdd workflow attach RUN_ID` | `Attach to the saved active background stage; archived stages return information.` |
| `workflow.<name>` | `pdd workflow <name> [--agent codex\|claude] [request text]` | `Open a native conversation following the bundled <name> recipe; default codex.` |
| `session` | `pdd session [--agent codex\|claude] [request text]` | `Open an installed native agent with the full guide and manual recipes; default codex.` |
| `help` | Four records: `pdd`, `pdd --help`, `pdd -h`, `pdd help` | `Show local alpha commands.` for each |
| `version` | `pdd --version` | `Show this package version.` |
| `skill` | `pdd --skill` | `Print the full Prompting guide, then the skill and its references.` |
| `completion` | `pdd completion bash\|zsh` | `Print local shell completion.` |
| `workflow.list` | `pdd workflow list [--json]` | `List validated project and bundled workflow definitions.` |

</details>

## Record shapes and frozenness

<details>
<summary><strong>Route, operand, option and form records, absent keys and frozenness</strong></summary>

Records have only the keys named here.

- **Route**: `{ id, prefix, local, operands, options, forms }`, plus `workflowName` on recipe shortcut routes. IDs are unique strings. `prefix` is a non-empty array of literal words, unique across routes. `local` is a disposition from the route table; the value `session` marks a conversation route for the parser and the CLI. `operands` is in positional order. `forms` is never empty.
- **Operand**: `{ name, type }`. Only `request` also has `optional: true` and `repeat: true`; other operands lack these keys. Only the last operand of a route may repeat.
- **Option**: `{ name, kind }`, where `kind` is `flag` or `value`. A `value` option also has `choices`, a non-empty array of allowed strings in table order. A `flag` option has no `choices` key.
- **One choice list per option name.** Every route that declares `--agent` gives it the choices `codex` then `claude`. Reason: completion offers one choice list for each option name.
- **Form**: `{ form, description }`, two strings.

The four exported arrays are frozen. Each route record, its `prefix`, `operands`, `options` and `forms` arrays, and every operand, option and form record are frozen. A write to any of them fails, with a `TypeError` in strict mode, and the catalog stays unchanged. The `choices` arrays may be frozen or not; consumers must not change them.

</details>

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) — authoring and review method for this prompt.
- [public boundary](public-boundary.prompt.md) — owner of the public command scope; authoring and review. Local consequence: the twelve routes above are the complete public command surface.
- [bundled workflows](bundled-workflows.prompt.md) — owner of the bundled workflow definitions and recipes; authoring and testing. `BUNDLED_WORKFLOW_NAMES` names exactly its three bundled workflows.
- No module, Node built-in or external tool. The module uses only JavaScript language facilities. Other links in this prompt are navigation only.
