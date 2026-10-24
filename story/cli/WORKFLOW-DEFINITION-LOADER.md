# Story: edit a workflow safely, and run exactly what was checked

Draft for review. A person has not accepted it yet.

## Request and scope

As a user of the PDD workflow runner, I want to add a workflow or change the stages and Markdown of one in my project, so that my team can use its own process without a change to PDD code. I also want a broken or unsafe edit to refuse clearly instead of quietly running bundled or partial instructions. As a maintainer of the runner, I want one immutable snapshot of the exact checked bytes, so that a saved run never picks up later edits.

The [owning prompt](../../prompts/cli/workflow-definition-loader.prompt.md) holds the rules. This Story preserves its two synchronous module functions, `loadWorkflowDefinition` and `listWorkflowDefinitions`, their argument objects and result shapes, the selection rule, the closed schema, the stage-order rules, the limits and the refusals.

Out of scope: what the bundled `feature`, `bug` and `small-change` definitions contain ([bundled workflows](../../prompts/cli/bundled-workflows.prompt.md)), how stages and protocols execute and how a run is saved and resumed ([runner](../../prompts/cli/workflow-runner.prompt.md)), and how `workflow list` prints and maps a refusal to an exit code ([CLI dispatch](../../prompts/cli/pdd-cli.prompt.md), [workflow list](../../prompts/cli/workflow-list.prompt.md)).

## Observable acceptance criteria

- **AC1:** Without a project entry, `loadWorkflowDefinition` returns the bundled definition, and `root` is the canonical bundled directory. With a valid project entry, `root` is the project directory and every snapshot file comes from it. An unknown name refuses.
- **AC2:** An existing project entry that is not valid refuses, also when a valid bundled definition has the same name. This includes a missing or malformed `workflow.json`, a missing declared Markdown file, and an entry that is a regular file or a symbolic link. Nothing from the bundled definition is returned.
- **AC3:** The result has the shape and the `files` and `digest` meaning that the prompt section "Return an immutable snapshot" gives. Each `sha256` matches the exact file bytes. A change to any snapshot byte changes `digest`; the location does not. A repeat load of unchanged files is deeply equal. A write to the result fails and changes nothing.
- **AC4:** The requested name follows the rule "workflow name". A 64-character name loads. An invalid name, including a 65-character one, refuses before any file read.
- **AC5:** The closed schema holds: an unknown, missing, `null` or wrongly typed field, a field not allowed on its kind or protocol, a wrong `version` or `name`, and a stage count outside 1 to 64 each refuse. A returned stage has the schema defaults.
- **AC6:** Every rule in "Path, file and size rules" holds. An unsafe instruction path, a symbolic link, a hard-linked file, a file over 256 KiB, invalid UTF-8 or a snapshot over 2 MiB refuses. A file of exactly 256 KiB loads.
- **AC7:** Every rule in "Stage-order rules" holds, and stage IDs can have any valid names. A definition that breaks one rule refuses. A definition that keeps all of them loads.
- **AC8:** `listWorkflowDefinitions` returns each candidate name once, sorted, with the correct `source`. It ignores entries that are not candidates. If one candidate refuses, the whole listing refuses and returns no partial list.
- **AC9:** Loading and listing write no file and start no Git, native agent, network or child process. No JSON field is run as a command. In the workflow directory, only `workflow.json` and the declared Markdown are read.

## Cases and evidence

The independent [expected cases](../../vectors/cli/workflow-definition-loader.json) map to these criteria. Their expected values come from the prompt, not from running the module.

These existing tests are evidence. This Story does not claim that they ran.

- AC1, AC3, AC7 and AC8: `test/workflow-definition-loader.test.mjs`, test "arbitrary safe names and renamed semantic stages load without a PDD code change".
- AC1, AC2 and AC8: the same file, test "whole local override wins; missing or malformed local config never falls back".
- AC3: the same file, test "snapshot bytes and digest remain immutable; later Markdown or JSON edits produce a new digest". `test/workflow-runner.test.mjs` tests "editable renamed workflow snapshots full bytes BEFORE allocation", "changed recipe source or missing whole override cannot replace saved instructions on resume" and "same-name workflows in separate projects retain distinct accepted content" check how the runner uses the snapshot.
- AC4 and AC6: the same loader test file, tests "traversal, absolute paths, malformed names and undeclared-file loading refuse", "recipe directory, instruction and metadata-parent symlinks cannot escape selection" and "hardlinked and oversized files refuse".
- AC5 and AC9: the loader test "finite schema rejects duplicate IDs, unknown fields, invalid types and execution kinds", which includes an `argv` field.
- AC7: the loader tests "graph refuses forward/wrong-kind references and unapproved or unverified publication", "human proposal approval and optional proposal PR merge dependencies are explicit" and "verified publication requires mandatory verification after every later work stage".
- AC8: the loader test "discovery unions actual project and bundled names without hardcoding three recipes". `test/cli-editable-routing.test.mjs` checks that `workflow list` calls the listing once and fails when it throws.
- No existing test checks: invalid UTF-8, the 2 MiB snapshot limit, the exact 256 KiB boundary, the 64-character name and 64-stage boundaries, a `null` field, a report-only definition, ignored listing entries, a change during a read, a symbolic-link root, digest independence from location, or the absence of writes and processes.

Passing these finite cases is evidence, not proof.

## Open questions

- A `null` `requiredRoles` on a non-proposal agent stage: the prompt refuses `null` in any field, but the current source treats it as an empty list. Is the prompt rule accepted, so that the source must change?
- Must a new implementation keep the exact `digest` encoding and `files` order of the current one? If either changes, a run saved before an upgrade refuses on resume.
- Several current refusal messages do not name the stage or file, and a missing file surfaces as the file system's own error. Is the prompt rule "the message identifies the faulty definition, stage or file" accepted as written?
