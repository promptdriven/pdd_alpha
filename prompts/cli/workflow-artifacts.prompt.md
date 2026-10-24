# Workflow handoff artifacts

Owns `src/workflow-artifacts.mjs`. Exports the async module functions
`readWorkflowHandoff(...)`, `assertWorkflowArtifacts(...)` and
`runWorkflowTestCommands(...)`.

The [workflow runner](workflow-runner.prompt.md) uses them to turn a stage
agent's claims into observations: a summary, listed digest or claimed test pass
proves nothing. Refusals reject the promise: those the module detects use
`TypeError` with a message naming the failed check, while filesystem and JSON
errors may pass through.

The module only reads files and, in `runWorkflowTestCommands`, runs the given
argv. It writes nothing and runs no Git, shell or network operation. The caller
owns Git HEAD, currentness, approval, the journal and publication.

Preservation: behavioral refinement. Keep the export names and binding kind,
request fields, `ports` options, handoff schema, result shapes, refusal
conditions and recorded exit codes. Helpers, check order unless stated, message
wording and read technique may vary.

## Check a handoff and its files

`readWorkflowHandoff({handoffPath, cwd, expected, requiredRoles = []}, ports = {})`
resolves with the handoff only when all of these hold:

- It is a regular file inside the project's Git metadata (**Handoff location**).
- It follows the closed schema, and its identities equal `expected` exactly.
- Each role in `requiredRoles` is on at least one listed file.
- Each listed file passes the **Artifact checks**.

It returns the parsed JSON unchanged and adds no default, such as an empty
`testCommands`. It checks the shape of `testCommands` but never runs them.

`assertWorkflowArtifacts({cwd, files}, ports = {})` applies the file schema and
artifact checks and resolves with `undefined`; an empty list is valid. Each call
reads the files again, so the caller detects a change after acceptance.

<details>
<summary>Request, handoff schema and identities</summary>

**Nonempty** means a string with a non-whitespace character and no NUL.
`expected` has exactly `runId`, `stageId`, `issueUrl` and `inputRevision`, each
nonempty. `requiredRoles` is an array of distinct known roles.

The handoff is UTF-8 JSON: an object with exactly `version` (the number `1`),
those four identities, a nonempty `summary`, `files` and an optional
`testCommands`. Identities match without normalization, so a handoff from
another run, stage, issue or input revision cannot pass because its files are
unchanged.

Each `files` entry has exactly `path`, `sha256` (64 hexadecimal digits, either
letter case) and `role` (`prompt`, `story`, `cases`, `implementation`, `tests`,
`evidence` or `notes`). A repeated `path` is refused. An empty `files` array is
valid; what a stage must list is caller policy. A present `testCommands` must
pass the **Argv rules**.

</details>

<details>
<summary>Handoff location, artifact checks and actual bytes</summary>

**Handoff location.** The metadata directory is `<cwd>/.git` when that is a real
directory, or the directory named by a regular `.git` file containing exactly
`gitdir: <path>` and an optional line end (relative to `cwd`). A missing,
symlinked or other `.git` is refused. `handoffPath`, absolute or relative to
`cwd`, has no backslash and no `.` or `..` segment, and names a regular file
strictly inside that directory. Never look elsewhere.

**Artifact checks.** `cwd` and the metadata directory must already be real
paths, with no symlink at any level. Each `path` is nonempty, canonical,
project-relative and slash-separated: not absolute, no drive prefix such as
`C:`, no backslash, no empty, `.` or `..` segment, and no `.git` segment in any
letter case, because Git metadata is not project content (`.github` is fine).
Every ancestor under `cwd` is a real directory and the file is a regular file,
never a symlink. The SHA-256 of the actual bytes equals `sha256`, ignoring
letter case.

**Actual bytes.** Hash bytes from the file that passed these checks, without
following a symlink. Refuse if it or an ancestor is replaced, or its size or
timestamps change, before the read ends. The same applies to reading the
handoff and the `.git` file. This is a local check, not a sandbox against
hostile concurrent change.

</details>

## Run test commands

`runWorkflowTestCommands({cwd, testCommands}, ports = {})` resolves with
`{passed, results}`. It first checks every argv entry and `cwd` (**Argv rules**,
**Artifact checks**); if one fails, it rejects and runs nothing. Then it runs
each command in order without a shell, also after a failure, and records
`{argv, exitCode, stdout, stderr}`. `passed` is true only when every `exitCode`
is `0`; output such as `PASS` never counts.

| Command outcome | Recorded `exitCode` |
| --- | --- |
| Resolved with an object and no truthy `signal` | Its own `exitCode`, else `code`, else `0`, if that is an integer of 0 or more; else `null` |
| Rejected with an integer `code` above 0 and no truthy `signal` | That `code` |
| Anything else, such as a non-object result, a signal, a spawn failure (`ENOENT`) or a rejection with code `0` | `null` |

`stdout` and `stderr` hold the actual output as strings. A rejection without
stderr records the error message there; a resolved result that is not a normal
exit gets a diagnostic line added to `stderr`.

<details>
<summary>Argv rules and execution</summary>

**Argv rules.** `testCommands` is a nonempty array of nonempty arrays of strings
without NUL. Arguments may be empty and stay literal, spaces and shell
characters included. The executable is nonempty, with no whitespace, backtick
or any of `;&|<>$()`. Its base name, in any letter case, is not a shell: `sh`,
`bash`, `dash`, `zsh`, `fish`, `csh`, `tcsh`, `ksh`, or `cmd`, `powershell` or
`pwsh` with or without `.exe`. So shell text cannot enter as a test.

**Execution.** Call `execFile(executable, args, {cwd})` with the resolved
project directory and no other option, so Node defaults apply: no timeout, and
output beyond the default buffer limit records `null`. `ports.execFile` may
replace it in callback form `(error, stdout, stderr)` or promisified form. A
synchronous throw is a rejection.

</details>

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) — authoring and review method for this prompt.
- [Workflow runner](workflow-runner.prompt.md) — the only caller; consumer
  contract for these calls and owner of the caller decisions. Uses: authoring
  and testing.
- Node built-ins — `node:fs/promises` with `node:fs` constants, `node:crypto`
  (SHA-256), `node:path` and `node:child_process` (`execFile`). Uses:
  generation and runtime. `ports.fs` may replace `node:fs/promises`; reads use
  its `lstat`, `realpath` and `open` (handle `stat`, `readFile`, `close`).
- No external tool; the module runs only the executables named in the given
  argv.
