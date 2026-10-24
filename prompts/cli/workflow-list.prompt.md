# Workflow list

Owns `src/workflow-list.mjs`. Exports the synchronous module functions `formatLocalWorkflows(catalog, { json })` and `listLocalWorkflows({ cwd, readDir, stat })`.

`formatLocalWorkflows` turns a workflow catalog into the text that `pdd workflow list [--json]` prints. [CLI dispatch](pdd-cli.prompt.md) builds the catalog from the [definition loader](workflow-definition-loader.prompt.md) listing and calls only this function. `listLocalWorkflows` is a legacy export that finds manual Markdown recipes in a project. No module in `src/` calls it; keep it for callers that this repository cannot see. Neither function runs, validates or chooses a workflow.

Preservation: behavioral refinement. Keep both exports and their binding kind, the catalog shapes, the JSON output's fidelity to the supplied catalog, the facts in human output, and the legacy discovery rules and errors. Human wording, spacing and private helpers may vary.

## Catalog and output

A catalog is `{ workflows, default }`. `default` is always `null`, because PDD never chooses a default workflow. An entry is one of these:

- a definition entry `{ name, source }`, where `source` is `project` or `bundled`. The CLI supplies these from the loader.
- a legacy recipe entry `{ name, file }`, from `listLocalWorkflows`.

`formatLocalWorkflows` reads and writes nothing. It returns a string without a trailing newline, because the caller ends the line. It keeps the supplied entry order and never sorts. `json` defaults to `false`.

- **JSON** (`json` is truthy): the supplied catalog as one JSON document, unchanged, with every field, the entry order and `default: null`. Reason: [shell completion](completion.prompt.md) reads `workflows[].name` from this output as data.
- **Human** (otherwise): one line per entry, with its name and then its `file` if present, else its `source`. An empty list gives one line that says no workflow definitions were found. A last line always says that listing starts no work and that `pdd workflow run NAME ISSUE` executes a validated definition. Reason: a reader must not think that listing started work, or that PDD has no runner.

<details>
<summary><strong>Legacy Markdown discovery: inputs, listed-recipe rule, order and errors</strong></summary>

`listLocalWorkflows` is not executable authority. A listed recipe is only Markdown for a person or an agent conversation to read. `workflow list` and the runner do not use this function, so a listed recipe does not become runnable. Its folder can lack `workflow.json` or have a name that the loader refuses.

All inputs are optional. `cwd` defaults to `process.cwd()`. Tests can replace the filesystem through two ports:

- `readDir` defaults to `fs.readdirSync`. It is called with `{ withFileTypes: true }` and returns entries with `name` and `isDirectory()`.
- `stat` defaults to `fs.lstatSync`, which does not follow symbolic links. It returns `isDirectory()`, `isFile()` and `isSymbolicLink()`, or throws an error with a `code`.

Rules:

- **Empty catalog:** return `{ workflows: [], default: null }` when `<cwd>/.pdd` or `<cwd>/.pdd/workflows` is missing, is not a directory or is a symbolic link.
- **Listed recipe:** list an entry of `.pdd/workflows` only when it is a real directory (not a symbolic link), its name has 1 to 64 characters from lowercase letters, digits, `.`, `_` and `-` and starts with a letter or a digit, and its `WORKFLOW.md` is a regular file (not a symbolic link or a directory). Skip every other entry without an error. This name rule is wider than the loader's rule. That is acceptable because these entries do not run.
- **Entry and order:** each entry is `{ name, file }`. `file` is `.pdd/workflows/<name>/WORKFLOW.md`, relative to `cwd`, with the platform path separator. Sort the entries by name with the default locale comparison (`localeCompare`).
- **Errors:** a filesystem error other than `ENOENT` (missing) or `ENOTDIR` (not a directory) propagates to the caller. Return no partial catalog.
- **Effects:** check file metadata only. Never read recipe content, follow a symbolic link, create `.pdd`, install recipes or set a default.

</details>

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) — authoring and review method for this prompt.
- [Public boundary](public-boundary.prompt.md) — shared command scope and exit codes. Local consequence: listing is local discovery, so these functions create no files and start no native agent, Git or GitHub work. The CLI owns the exit code of `workflow list`. Authoring and generation.
- Node built-ins `node:fs` (`readdirSync` and `lstatSync` as default ports) and `node:path` (join paths and make `file` relative to `cwd`) — runtime.
