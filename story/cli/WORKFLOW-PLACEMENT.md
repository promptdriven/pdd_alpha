# Story: CLI machine placement

Draft for review; examples are synthetic.

## Request and scope

As a person starting an agent or workflow, I want to choose `auto` or one of my own machines, so that I can keep interactive work local, send a long workflow to an eligible always-on machine, and know exactly where the work lives. A remote start must use a clean clone of the canonical repository on that machine and must not move my local changes or credentials.

The [machine placement prompt](../../prompts/cli/workflow-placement.prompt.md) owns the contract. Workflow stages, native account choice, machine enrollment and remote transport implementation are out of scope.

## Observable acceptance criteria

- **AC1:** Both `pdd session` and `pdd workflow run` accept `--on auto` or one exact, unique machine name. Omitted `--on` defaults to `auto`; missing, unknown and ambiguous values fail before a start.
- **AC2:** Without the optional Client port, `--on auto` follows the existing local path. A named remote machine returns `remote_unsupported` with no remote lookup or start.
- **AC3:** A Client candidate is eligible only when owned, online, Herdr-ready, with the selected tool installed, room under its machine/tool Settings policy and strictly more than 5 GB free disk; exactly 5 GB is ineligible.
- **AC4:** For session auto placement, the highest score among all eligible machines wins. The score is +20 for a clean canonical clone, −5 per working agent and −50 for the `laptop` tag. Equal scores choose ascending machine name, then stable id.
- **AC5:** Workflow auto placement selects from eligible `alwaysOn` machines when any exist. If none are eligible, it stays at the source machine when that machine is eligible. It never falls back to another untagged machine; an ineligible source is a refusal.
- **AC6:** An explicit ineligible target is refused without starting elsewhere. Eligibility and target identity are rechecked by the port immediately before a remote effect.
- **AC7:** Remote work requires a canonical repository URL and remotely reachable pinned ref, and receives only those plus the user's explicit task inputs. Without that repository identity, auto stays on the local path and an explicit machine is refused before effects. Dirty source or target work, local-only commits, environment and credentials are absent and remain untouched.
- **AC8:** The caller durably binds a unique `startId` to one target before dispatch. A lost reply is inspected on that same target with that id; unknown delivery returns `uncertain` without a second start or reroute.
- **AC9:** After a start is accepted, all stages and the controller remain on that machine. A sleeping machine pauses the run; placement does not migrate or replace it.
- **AC10:** The adapter is an optional local interface supplied by Client. Alpha has no private import or deployed-service dependency; without the port remote starts are unsupported.

The independent [expected cases](../../vectors/cli/workflow-placement.json) describe contract outcomes, not results observed from code.


## Round 2 acceptance

- **AC11:** Remote requests carry project name/id and explicit model/effort overrides, never account preferences or source defaults; the target resolves its own defaults and validates its own CLI list.
- **AC12:** Project names are shown while physical clone/worktree folders stay internal; explicit project clones use the Settings base, without altering dirty work.
