# Bundled guidance loading

Owns `src/guidance.mjs`. Exports the module function `loadGuidance({ packageRoot, cwd, workflows, workflowName })`.

The module builds the one text that brings PDD's bundled guidance into a native agent conversation: the complete Prompting guide first, then the skill, its references and, when asked, the workflow overview and recipes. It is the single content source for `pdd --skill`, for session and recipe shortcut startup, and for the base context of each runner stage. It does not validate workflow definitions, install files or launch an agent.

Inputs: `packageRoot`, the package folder (callers pass an absolute path); `cwd`, the project folder, which the module names but never reads; `workflows`, a Boolean that defaults to `false`; `workflowName`, omitted or one name from `BUNDLED_WORKFLOW_NAMES`. `pdd --skill` and runner stages use `workflows: false`. `pdd session` uses `workflows: true`. Recipe shortcuts also pass `workflowName`.

The call is synchronous. It returns one string in the [output layout](#output-layout), or it throws and returns nothing. It only reads package files.

Preservation: behavioral refinement. Keep the export, its module-function binding, the synchronous string result and every rule below. Instruction wording may vary if its meaning and the named markers stay. Error class, message and traversal method may vary.

## Load order

Load these files from `packageRoot`, in this order:

1. `docs/prompting-guide.md`.
2. `skills/pdd/SKILL.md`.
3. Each eligible file under `skills/pdd/references/`, in scan order.
4. Only with `workflows: true`: `docs/workflows.md`, then the recipes:
   - without `workflowName`, each eligible file under `.pdd/workflows/`, in scan order;
   - with `workflowName`, `.pdd/workflows/<workflowName>/WORKFLOW.md`, then each other eligible file of that recipe folder, in scan order. No file of another recipe loads.

The guide is first because the agent must read all of it before any Story, and a link is not loaded context. A shortcut gets only its chosen recipe, so unrelated recipes are not initial context. `workflowName` is a catalog name, never a path. Project instructions under `cwd` stay with the native agent, which loads them in its normal way.

<details>
<summary><strong>Scan order, eligible files, links and load errors</strong></summary>

- **Scan order:** recursive. In each folder, sort entries by name with plain code-unit comparison, not locale order. A subfolder's files appear at the subfolder's sorted position.
- **Eligible file:** a regular file whose name ends in `.md` (case-sensitive). Skip other entries that are neither folders nor links, such as `workflow.json`.
- **Link refusal:** a symbolic link at a fixed file, at a scanned folder or anywhere inside a scanned folder fails the call, also when its name does not end in `.md`. Never follow or silently skip a link: it can bring in outside content, and a skip makes an incomplete bundle look complete. Parent folders above these paths are not checked.
- **Fixed files:** the guide, `SKILL.md`, and when needed `docs/workflows.md` and the selected `WORKFLOW.md` must exist as regular files, or the call fails.
- **References folder:** if absent, there are no reference sections and the call continues. If it exists but is not a real folder, the call fails.
- **Recipe folder:** with `workflows: true`, the scanned recipe folder must be a real folder with at least one eligible file, or the call fails.
- **Workflow name:** any `workflowName` other than `undefined` must be in `BUNDLED_WORKFLOW_NAMES`, or the call fails. So `null` and the empty string fail.

</details>

## Complete text, all or nothing

Each loaded file appears with its complete UTF-8 text. Do not truncate, trim, rewrite or summarize it, and set no size limit. Read every selected file before returning. A missing, unreadable or refused file makes the call throw, so a caller never gets a partial bundle. The call has no other effects: it writes and copies nothing, starts no process, uses no network and changes no environment.

## Output layout

One string. Parts come in this order, separated by blank lines:

| Part | Required content |
| --- | --- |
| Title | The first line is `# PDD Alpha conversation guidance`. |
| Package | `Package root: <packageRoot>`. |
| Project | `Current project: <cwd>`, with `cwd` as given. The runner finds this exact line and renames it in a stage context. |
| Guide first | Tells the agent to read the entire guide below before any Story drafting, to summarize its relevant method first, then to follow the skill and recipes. Contains `Read the ENTIRE Prompting guide`. |
| Authority | Says that project instructions loaded by the native agent stay in force, and that recipes, sessions and shortcuts are manual guidance. For explicit `workflow run` or `workflow resume`, the runner's current-stage instructions own progression and PR steps. Never imply that the conversation is the runner or that PRs are automatic. |
| Selected recipe | Only with `workflowName`. Begins `Selected bundled workflow: <workflowName>.` Tells the agent to follow that recipe after the guide summary. Says that a shortcut is one native conversation, while explicit run or resume follows runner stages. |
| Argv prefix, command use | See [installed command identity](#installed-command-identity). |
| Files | Per loaded file, in load order: the line `--- <path> ---` with `packageRoot` joined to the relative path, a blank line, then the complete text. |

**Stable result:** the same inputs, package files and Node executable path give the same string, byte for byte. The runner saves the result at run start and refuses to continue a run when a fresh result differs. So a change to package files, the Node path or this module's wording also stops saved runs from continuing.

## Installed command identity

A native agent tool often runs commands in a login shell. That shell can set its own PATH and resolve bare `pdd` to another, older or private installation, even when the outer terminal resolves this package. So every result, also with `workflows: false`, names the exact command:

- **Command pair:** `process.execPath`, then the absolute path of `bin/pdd.mjs` under `packageRoot`. Do not require the entry file to exist; only guidance files are required.
- **Argv prefix:** the label `Exact installed PDD argv prefix: `, then the pair as a JSON array on the same line, so a tool can parse the literal argv.
- **Command use:** the label `absolute executable prefix: `, then the shell-quoted prefix, directly followed by `. Append only the normal documented PDD arguments.` Put each value in POSIX single quotes, write each `'` inside a value as `'\''`, and join with one space, so a path with spaces or quotes stays one argument.
- **Instruction:** use this prefix for every PDD command instead of bare `pdd`, even when `command -v pdd` finds another installation. Do not change PATH, shell profiles, native settings or credentials. The prefix grants no extra authority.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) — authoring and review method for this prompt.
- [Public boundary](public-boundary.prompt.md) — shared scope and exit codes. Local consequence: a load failure is a throw, which the CLI reports as missing package guidance (exit code 1) before any output or native launch.
- [Command catalog](command-catalog.prompt.md) — owner of the frozen constant `BUNDLED_WORKFLOW_NAMES` in `src/command-catalog.mjs`. Uses: generation and runtime.
- [Bundled workflows](bundled-workflows.prompt.md) — owner of the recipe content under `.pdd/workflows/`, loaded here as text only. Uses: authoring and runtime.
- Package guidance files named in the load order. Uses: runtime input.
- Callers: [CLI](pdd-cli.prompt.md), [workflow runner](workflow-runner.prompt.md) (stage context, `Current project:` line, saved result) and [native session](native-session.prompt.md) (initial prompt). Uses: authoring and testing evidence for the output markers.
- Node built-ins: `node:fs` (file status without following links, folder listing, UTF-8 reads), `node:path` (join, resolve) and `process.execPath`. Uses: runtime.
