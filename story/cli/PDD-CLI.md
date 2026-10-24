# Story: each pdd command line reaches one owner and reports its real result

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who runs `pdd` in a project, or an agent that runs it inside a native session, I want each command line to reach exactly one owner with the right inputs, and to report that owner's real result on the right stream with the right exit code. Then I can trust help, script against exit codes, and never start runner work by accident.

The owning prompts are [CLI dispatch](../../prompts/cli/pdd-cli.prompt.md) for `src/pdd-cli.mjs` and [executable entry](../../prompts/cli/bin-entry.prompt.md) for `bin/pdd.mjs`. This Story preserves the module functions `renderHelp` and `runPdd`, the dispatch table, owner inputs and ports, exit codes, stream rules, help facts, and the entry's argv and exit behavior.

Out of scope: which argv the parser admits, the command forms in the catalog, guidance content, native launch arguments, runner progression and GitHub effects, definition validation, and completion script content. Their own prompts own them.

## Observable acceptance criteria

- **AC1 (parse first):** Every command line the parser refuses exits with code 2, writes a diagnostic to stderr and nothing to stdout. It reads no package file and makes no runner, loader or native call. A refused recipe name exits 2 even when the package root does not exist.
- **AC2 (help):** Root help, `workflow` group help and exact `workflow run`, `resume` and `attach` help exit 0 with empty stderr. They show every fact in the prompt's help table, including the PREVIEW notice and the real push and PR warning. Other help, such as `session --help`, has no PREVIEW notice. Help works when the package root and project folder do not exist, and it touches no runner, stage transport, definition loader or native launcher.
- **AC3 (version):** `--version` writes `pdd <version>` from the package root's `package.json` and exits 0. Missing metadata, or a `version` that is not a nonempty string, exits 1 with a stderr diagnostic and empty stdout.
- **AC4 (skill):** `--skill` writes the guidance text and exits 0. If guidance cannot load, it exits 1 and stdout stays empty.
- **AC5 (sessions):** `session` and `workflow feature|bug|small-change` load guidance with all recipes or only the selected one. Then they call the native launcher once with the agent (default `codex`), cwd, guidance and joined request. The exit code is the launcher's code unchanged. If guidance cannot load, the exit code is 1 and no launch happens. These commands never call the runner.
- **AC6 (runner dispatch):** `workflow run`, `resume` and `attach` call the matching runner function exactly once. The input objects follow the prompt's runner input table: no `context`, no agent for resume or attach, and `decision` only when given. The ports hold the guidance loader, the native launcher, the four stage transport exports and both streams.
- **AC7 (runner result):** For a valid result, stdout holds the runner's `message` and one newline, once, and nothing else from the result. The exit code is the runner's `exitCode` unchanged.
- **AC8 (runner failure):** A missing module or export, an incomplete stage transport, a thrown error or an invalid result exits 1. A diagnostic goes to stderr, this module writes nothing to stdout, and the runner is not called a second time. An incomplete stage transport prevents the runner call.
- **AC9 (listing):** `workflow list [--json]` calls the definition loader once with `{ cwd, packageRoot }` and writes the formatted `{ workflows, default: null }` listing. A loader failure or a non-array result exits 1 with empty stdout and no fallback listing. Listing starts no runner or native work.
- **AC10 (completion):** `completion bash` and `completion zsh` write the completion script unchanged and exit 0.
- **AC11 (executable entry):** `node bin/pdd.mjs <words>` passes the words to `runPdd`, and the process exit status equals its result.
- **AC12 (local and inert):** Help, version, skill, completion and listing create no file in the project or home folder, use no network and start no child process. Help works offline from an empty folder with an empty `PATH`.

## Cases and evidence

The independent [expected cases](../../vectors/cli/pdd-cli.json) map inputs to these criteria. Their values come from the prompts, not from running the implementation.

These existing tests exercise the criteria. They are evidence only; this Story does not claim that they ran.

| Criteria | Tests |
| --- | --- |
| AC1 | `test/cli.test.mjs` (ALPHA6 unknown recipes with an absent package root; ALPHA8 invalid runner argv), `test/cli-editable-routing.test.mjs` (invalid attach argv), `test/cli-preview-help.test.mjs` (unknown command with help through the entry) |
| AC2 | `test/cli-preview-help.test.mjs`; `test/cli.test.mjs` (ALPHA4 help forms through the packed entry) |
| AC3, AC10 | `test/cli.test.mjs` (ALPHA4, success only) |
| AC4 | `test/cli.test.mjs` (ALPHA2, ALPHA4) |
| AC5 | `test/cli.test.mjs` (ALPHA4 native exits and missing guide; ALPHA6 selected recipe and native code) |
| AC6, AC7 | `test/cli.test.mjs` (ALPHA7), `test/cli-editable-routing.test.mjs` (run with four transport ports; attach) |
| AC8 | `test/cli.test.mjs` (ALPHA8), `test/cli-editable-routing.test.mjs` (attach throws once) |
| AC9 | `test/cli-editable-routing.test.mjs` (listing), `test/cli.test.mjs` (ALPHA4 listing through the packed entry) |
| AC11 | `test/cli-preview-help.test.mjs` (entry help and refusal), `test/cli.test.mjs` (ALPHA4), `test/cli-installed-entry.test.mjs` (the absolute entry prefix runs this package despite an older `pdd` on `PATH`) |
| AC12 | `test/cli.test.mjs` (ALPHA4 network, process and file guard; empty home and project), `test/cli-preview-help.test.mjs` (folder unchanged) |

No existing test covers the version failure in AC3, the incomplete stage transport in AC8, a non-array listing in AC9, or a runner `exitCode` outside 0 to 255. Passing these finite cases is evidence, not proof over all command lines.

## Open questions

- The dispatcher passes any integer `exitCode` from 0 to 255 through unchanged, and it does not check that the code matches `state`. Should a mismatch, such as `completed` with exit code 1, be an invalid result?
- If `runPdd` rejects instead of resolving, the entry leaves the error to Node's default handler, which prints a stack trace. Should the entry catch it and exit 1 with a short diagnostic instead?
