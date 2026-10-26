# Story: pdd cli p1

Draft for review. I want to start and control a run from a terminal without tying its controller to this command.
[Owning prompt](../../prompts/cli/pdd-cli.prompt.md).

## Observable acceptance criteria

- **AC1:** Help succeeds without starting native work, network effects or a private client.
- **AC2:** A new run has one saved identity and one controller pane; the calling command returns.
- **AC3:** An unproved launch is uncertain and never creates a duplicate controller.
- **AC4:** Drive checks the current decision revision and uses the saved runtime.
- **AC5:** Adoption records ownership without starting a controller.
- **AC6:** Dry-run cleanup reports eligibility and changes no run file or worktree.
- **AC7:** Remote no client: unsupported = true; localStart = false.
- **AC8:** Decide json once: stdoutLines = 1; jsonV = 1; exitCodeUnchanged = true.
- **AC9:** Session local preserved: foregroundNative = true; fullGuideFirst = true; ownLoginPreserved = true.
- **AC10:** Unknown options give a usage error with no run, native-process or network effect.

[Expected cases](../../vectors/cli/pdd-cli-p1.json) are synthetic independent expectations, not execution results.


## Locked plan observations

- **AC11:** The public recovery command works without a private client.
- **AC12:** JSON status has version 1 and does not write run files or start a controller.


## Review fix acceptance

- **AC13:** A named run JSON result is one versioned status object, not a wrapper or result dump.
- **AC14:** A stale status file is replaced in the display by the last complete journal record, without repairing files.
- **AC15:** An unknown run id returns a finite versioned unknown result without starting work.
- **AC16:** An empty JSON listing is a versioned collection with no runs.
- **AC17:** Declining the old/new-runtime confirmation changes no run record and starts nothing.


## Preserved CLI observations

- **AC18:** Version prints only the package version and one newline without starting work.
- **AC19:** Skill output includes the complete guide before the skill/references and supplies absolute installed paths.
- **AC20:** An unreadable required guide or reference returns failure without claiming complete context.
- **AC21:** Executable-recipe discovery returns the loader catalog without installing or running a recipe.
- **AC22:** The proposed public doctor supports an Alpha-only candidate self-check and reports absent-client checks as skipped.


## Round 2 acceptance

- **AC23:** Projects lists named discovered projects without launching or cloning; session --project selects a unique name match and never asks for a folder path.
- **AC24:** An ambiguous project name reports candidates and starts nothing; an uncloned match requires an explicit Projects clone action.
- **AC25:** Session and workflow account start flags are rejected before effects; machine/tool Settings supplies the policy.
- **AC26:** Model/effort defaults and start overrides are validated on the selected machine before preparation; workflows freeze the effective pair.
- **AC27:** Help and discovery show project and model/effort options and make no catalog/tool/network reads unless requested.
