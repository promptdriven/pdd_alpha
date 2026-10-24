# CLI dispatch

Owns `src/pdd-cli.mjs`. Exports the module functions `renderHelp(prefix)` and `runPdd(argv, dependencies)`.

`runPdd` turns one `pdd` command line into one effect and resolves to an integer exit code. It owns the order of work, the owner each command reaches, the ports that owner receives, the output streams and the exit code. The owners decide everything else. The [executable entry](bin-entry.prompt.md) calls it.

`argv` holds the words after `pdd`. The optional `dependencies` object can replace `stdout` and `stderr` (default: the process streams; any object with `write(text)`), `cwd` (default `process.cwd()`), `packageRoot` (default: the folder above this module's `src/` folder), `nativeSession` (default `launchNativeSession`), and `workflowRunner`, `workflowStages` and `workflowDefinitions` (default: the runner, stage transport and definition loader modules, loaded on demand). Replacements exist for tests; no command-line flag selects them.

Preservation: behavioral refinement. Keep both exports and their binding kind, the dispatch table, owner inputs and ports, exit codes, stream rules, help facts and forbidden effects. Diagnostic wording outside the required help phrases, private helpers and the loading technique may vary.

## Parse first, then dispatch

**Parse first.** The shared [parse-first and no-echo rules](public-boundary.prompt.md#exit-codes-and-output) apply. Call `parseArgv(argv)` before any file read, owner module load or process start. If it throws, write one diagnostic line to stderr and resolve to 2: the message of a `CommandInputError`, or else a fixed pointer to `pdd --help`, never the raw words.

Then dispatch on the plan's `local` value. Each command calls its owner at most once.

| `local` value | Effect | Exit code |
| --- | --- | --- |
| `help` | Write `renderHelp(helpPrefix)`. | 0 |
| `version` | Write `pdd <version>`, with `version` from `package.json` in the package root. | 0; 1 if the file cannot be read or parsed, or `version` is not a nonempty string |
| `skill` | Write `loadGuidance({ packageRoot, cwd })`. | 0; 1 if guidance cannot load |
| `completion` | Write `renderCompletion(shell)` unchanged. | 0 |
| `workflow-list` | [Workflow listing](#workflow-listing) | 0; 1 on failure |
| `session` | [Native sessions](#native-sessions) | the launcher's code; 1 if guidance cannot load |
| `workflow-run`, `workflow-resume`, `workflow-attach` | [Runner commands](#runner-commands) | the runner's `exitCode`; 1 on [runner failure](#runner-failure) |
| any other value | Write a diagnostic. | 2 |

**Streams.** The shared [stream rules](public-boundary.prompt.md#exit-codes-and-output) apply: values on stdout, diagnostics on stderr, and nothing on stdout when this module refuses or fails. Each value ends with one newline, except the completion script, which already ends with one. The native launcher and the runner may also write to the streams they receive.

**Local commands stay local.** Help, version, skill and completion load no runner, stage transport or definition loader and call no native launcher; help does not touch any injected owner. `workflow list` loads only the definition loader. Reason: help and discovery must work when a workflow module is missing or broken. The shared [discovery effects](public-boundary.prompt.md#exit-codes-and-output) limit all five commands.

## Help text

`renderHelp(prefix)` takes an array of words, default `[]`, and reads only `PUBLIC_COMMAND_MANIFEST` from the [command catalog](command-catalog.prompt.md). Help exits 0 with empty stderr, even when the package root or project folder is missing.

Start with a title line that names "PDD Alpha" as local guidance for the person's existing coding-agent conversation. Then list each manifest form whose words after `pdd` begin with all prefix words; an empty prefix lists all. Each form gets its own line: two spaces, the form, two spaces, its catalog description. The catalog owns that text, including the `PREVIEW:` label of run, resume and attach.

Then write these facts in this order. Quoted phrases are required wording, because readers and accepted tests search for them.

| Fact | Shown in |
| --- | --- |
| "Workflow runner PREVIEW": "a real workflow PR is not yet proven". | only root help, `workflow` group help and exact `workflow run`, `resume` and `attach` help |
| Read the entire Prompting guide with `pdd --skill` before drafting any Story. | every help |
| Session and recipe shortcuts open foreground native conversations. Workflow run and resume "may push branches and create real PRs". | every help |
| The PDD controller must keep running while stage agents work in background Herdr. After it exits, nothing advances; explicit resume reconciles the original run. | every help |
| `workflow attach RUN_ID` reaches the actual active stage. Completed archived stages are not live sessions. | every help |

Accepted product decision: the workflow runner ships in this alpha as a preview. PREVIEW is a release label only. It adds no refusal, gate, flag or readiness claim. Help must not claim that the package never runs workflows, that native readiness proves stage success, or that a background PDD process continues a run.

## Native sessions

`session` and the recipe shortcuts `workflow feature|bug|small-change` share the `local` value `session`. Load `loadGuidance({ packageRoot, cwd, workflows: true, workflowName })` with the plan's `workflowName`: absent for `session`, so all bundled recipes load, or the one selected recipe. If guidance cannot load, write a diagnostic and resolve to 1 before any launch.

Then call the native launcher once with `{ agent, cwd, context, request, stderr }`. `agent` is the parsed `--agent` value or `codex`. `context` is the loaded guidance. `request` is the parsed operands joined by single spaces, or empty. Resolve to the launcher's exit code unchanged; [native session](native-session.prompt.md) owns it. Pass no environment, stdio setting or native flag. These commands get no stage transport and never call the runner.

## Workflow listing

Call `listWorkflowDefinitions({ cwd, packageRoot })` once; the [definition loader](workflow-definition-loader.prompt.md) owns which definitions exist and their `source`. Write `formatLocalWorkflows({ workflows, default: null }, { json })` from [workflow list](workflow-list.prompt.md), with `json` true only for `--json`. If the loader cannot load, throws or returns a non-array, write a diagnostic and resolve to 1. Do not fall back to Markdown-only discovery.

## Runner commands

These commands reach the [workflow runner](workflow-runner.prompt.md). It owns saved identity, journals, decisions, stages and GitHub effects. This module builds the input, binds the ports, waits and reports.

<details>
<summary><strong>Runner inputs and ports</strong></summary>

| Command | Call |
| --- | --- |
| `workflow run NAME ISSUE` | `runWorkflow({ name, issue, agent, cwd, packageRoot }, ports)`; `agent` is the parsed `--agent` value or `codex` |
| `workflow resume RUN_ID` | `resumeWorkflow({ runId, cwd, packageRoot, decision }, ports)`; the `decision` key exists only when `--decision` was given |
| `workflow attach RUN_ID` | `attachWorkflow({ runId, cwd, packageRoot }, ports)` |

No input has a `context` key, and resume and attach carry no agent: the runner loads the saved ones.

`ports` holds exactly `loadGuidance`, `launchNativeSession` (the `nativeSession` dependency), the four [stage transport](workflow-stage-herdr.prompt.md) exports `runHerdrStage`, `inspectHerdrStage`, `attachHerdrStage` and `closeHerdrStage`, and `stdout` and `stderr`. All three commands get all four. If one is not a function, that is a runner failure and the runner is not called.

</details>

`runPdd` stays pending until the runner call settles. It does not detach or start a later stage, because this process is the foreground controller.

**Valid result.** An object whose `state` is `completed`, `waiting`, `failed` or `recovery_required`, whose `exitCode` is an integer from 0 to 255, and whose `message` is a string with visible text. Write `message` and one newline to stdout once, for every valid state, and never the object or its other fields. Resolve to `exitCode` unchanged: the runner owns the state-to-code mapping, and waiting is not completion.

<a id="runner-failure"></a>**Runner failure.** If the runner or transport module cannot load, a needed export is missing, the runner throws or rejects, or the result is not valid, write one stderr diagnostic and resolve to 1. The diagnostic says to inspect saved state before repeating a mutation, and that no retry was sent. No second call or other path follows.

**Forbidden.** This module never reads or writes a journal, calls GitHub, records an approval, treats native exit 0 as stage success, resumes after a run, chooses the active stage for attach, or starts a conversation for archived history. It imports no private Host, adapter or backend, not even as an unused default.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) — authoring and review method for this prompt.
- [public boundary](public-boundary.prompt.md) — shared [command scope](public-boundary.prompt.md#command-scope) and [exit codes and output](public-boundary.prompt.md#exit-codes-and-output) (authoring, generation). Local consequence: the exit codes, parse-first order, streams and discovery limits in this prompt; no private fallback.

The entries below are used for generation and runtime. The last three load on demand.

- [command catalog](command-catalog.prompt.md) — `PUBLIC_COMMAND_MANIFEST` forms and descriptions.
- [argument parser](argument-parser.prompt.md) — `parseArgv(argv)`, `CommandInputError`, and the plan fields `local`, `operands`, `options`, `helpPrefix` and `workflowName`.
- [guidance](guidance.prompt.md) — `loadGuidance(...)` for `--skill`, sessions and the runner port.
- [native session](native-session.prompt.md) — `launchNativeSession(...)` for sessions and the runner port.
- [completion](completion.prompt.md) — `renderCompletion(shell)`.
- [workflow list](workflow-list.prompt.md) — `formatLocalWorkflows(catalog, { json })`.
- `package.json` in the package root — the `version` field.
- Node built-ins — `node:fs` `readFileSync` for package metadata; `node:path` and `node:url` to find the package root.
- [definition loader](workflow-definition-loader.prompt.md) — `listWorkflowDefinitions({ cwd, packageRoot })`.
- [workflow runner](workflow-runner.prompt.md) — `runWorkflow`, `resumeWorkflow`, `attachWorkflow`, their result shape and exit mapping.
- [stage transport](workflow-stage-herdr.prompt.md) — the four exports bound as runner ports.
