# Story: complete pdd commands and workflow names in my shell

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who types `pdd` commands in bash or zsh, I want the shell to complete command words, option values and the workflow names of my current project, so that I type valid commands faster. Completion must never run a workflow, an agent or text from the listing.

The [owning prompt](../../prompts/cli/completion.prompt.md) holds the rules. This Story makes them observable. It preserves the module function `renderCompletion(shell)`, the shell function and registration names, the words offered at each position and the single listing call with its safety and failure rules.

Out of scope: which commands exist (the command catalog), parsing and refusing a typed command (the argument parser), how the listing finds and validates definitions (the definition loader), and installing the script into a shell's startup files.

## Observable acceptance criteria

- **AC1:** `renderCompletion('bash')` and `renderCompletion('zsh')` each return text that ends with a newline. Any other value, including `Bash`, `fish`, `null` and a missing argument, throws `TypeError`. Rendering reads no file, starts no process and makes no network call.
- **AC2:** Sourcing the bash text registers `_pdd_complete` for `pdd`. Sourcing the zsh text after `compinit` registers `_pdd` for `pdd`. Loading starts no program.
- **AC3:** For each line in the prompt's position table, the loaded script offers exactly the listed words, filtered by the typed part, in both shells. No excluded command word, such as `runtime`, `doctor`, `verify` or `lint`, is ever offered.
- **AC4:** When the previous word is `--agent`, the script offers exactly `codex` and `claude`. When it is `--decision`, it offers exactly `approve` and `skip`. This holds at every position, also after NAME, ISSUE and RUN_ID.
- **AC5:** For word 3 after `workflow run`, the script runs `pdd` exactly once with the arguments `workflow`, `list`, `--json` in the current directory. It offers the safe names from the reply, including project names that are not bundled.
- **AC6:** A listed name that breaks the prompt's safe-name rule is not offered. Listing text is never run: a name such as `$(touch marker)` creates no file.
- **AC7:** When the listing is missing, fails, prints text that is not JSON or has no `workflows` array, the script offers no names. It does not offer `feature`, `bug` or `small-change` instead.
- **AC8:** At every other position the script starts no program. At no position does it start another `pdd` command, a native agent or a network request.
- **AC9:** `pdd completion bash` and `pdd completion zsh` exit with code 0 and print the rendered text unchanged to stdout. `pdd completion fish` and `pdd completion` exit with code 2 and print nothing to stdout.

## Cases and evidence

The independent [expected cases](../../vectors/cli/completion.json) map inputs to these criteria. They were written from the prompt, not from running the module. In completion cases, `wordsAfterPdd` lists the words after `pdd`; the last one is the word being completed. `offered` is compared as a set, because the order of offered words is free. `listingReply` describes the fake `pdd` on `PATH`.

Existing tests are evidence for the criteria. This Story does not claim that they ran.

- `test/cli.test.mjs`, test `ALPHA1`: the parser accepts `completion bash|zsh` and refuses `completion fish` and `completion` (AC9).
- `test/cli.test.mjs`, test `ALPHA4`: the packed package prints both scripts with exit code 0 and no excluded words. It loads each script and checks word 2 after `workflow`, `--agent` values after a recipe shortcut and `--decision` values after RUN_ID (AC2, AC3, AC4, AC9).
- `test/cli-editable-routing.test.mjs`, test `bash/zsh NAME completion reads local definition listing as data`: one exact listing call per shell, a project name offered, and a hostile name dropped without creating its marker file (AC5, AC6).

No existing test checks AC1's `TypeError`, AC7's failure cases or the absence of a listing call at other positions (AC8). Passing these finite cases is evidence, not proof over all command lines.

## Open questions

- `workflow run` never offers its `--agent` name, and `workflow resume` offers `--decision` only before RUN_ID. Should option names also be offered after operands? The prompt keeps the current behavior.
- If `node` is missing, the shell's own "command not found" message can appear while completing. Should completion hide it?
