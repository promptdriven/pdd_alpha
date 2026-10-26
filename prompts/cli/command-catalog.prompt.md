# Alpha local command catalog

Own `src/command-catalog.mjs`; export only `PUBLIC_COMMAND_ROUTES`, `PUBLIC_COMMAND_IDS`, `PUBLIC_COMMAND_MANIFEST`, and `BUNDLED_WORKFLOW_NAMES` (feature, bug, small-change). Catalog the complete small alpha surface: root help, --version, --skill, completion bash|zsh workflow list [--json], and session [--agent codex|claude] [request text]. Each route has stable id, exact prefix, local disposition, operand/option specs and plain help forms. Expose no excluded command, private schema/type, service flag or hosted execution operation. Help, parser and completion share this one authority.

## Dependencies

Read the entire [Prompting guide](../../docs/prompting-guide.md) before authoring prompts or Stories. Follow [public alpha boundary](public-boundary.prompt.md) for scope and the shared local command contract.

Catalog one local native route for each bundled workflow name. Each has the same optional --agent choices/default and request operands as session, and carries its exact workflow name in the local plan. No arbitrary path or workflow creation route.

Catalog workflow.run (`workflow run`) with required safe free workflow NAME and ISSUE number|owner/repo#positive-number|https://github.com/owner/repo/issues/positive-number; optional --agent codex|claude defaults codex. Catalog workflow.resume (`workflow resume`) with one UUIDv4 RUN_ID and optional --decision approve|skip. Resume has no agent override. No extra request text or native flags. Later routes and options (workflow status, drive, adopt, clean, upgrade, projects, --on, --project, --model, --effort) are catalogued in [P1 command routes](pdd-cli.prompt.md#p1-command-routes).

For editable workflow execution, workflow.run NAME is a safe free workflow-name operand, not a three-name enum. The dedicated definition loader alone decides available definitions/semantic validity. Preserve the three bundled direct conversation shortcuts as separate foreground routes. Add workflow.attach: `pdd workflow attach RUN_ID`, one UUIDv4, no agent/decision/native/path flags; main resolves actual active saved identity or finite archived information. List describes validated project/bundled definitions; no private route.


## Workflow runner help

Describe workflow.run, workflow.resume and workflow.attach without preview labels. Keep their route IDs, prefixes, local dispositions, operands/options/forms and parser/completion behavior consistent with their contracts.

## Workflow decide

Catalog workflow.decide (`workflow decide`): `pdd workflow decide RUN_ID --decision approve|skip --id DECISION_ID --expect-stage STAGE --expect-seq N [--json]`. RUN_ID and DECISION_ID are UUIDv4; STAGE follows the stage-id rule; N is a positive decimal with no leading zero; every option except `--json` is required. workflow.resume adds optional `--id DECISION_ID` (needs `--decision`) and `--expect-stage STAGE` with `--expect-seq N` (both or neither; they need `--id`). Behavior belongs to [workflow decide](workflow-decide.prompt.md) and the [runner](workflow-runner.prompt.md).

## Phone and Link

Catalog phone (`phone`): `pdd phone [--relay URL] [--name NAME] [--codex PATH] [--claude PATH] [--no-integrations]`; the first four are value options, `--no-integrations` is a flag, each at most once. Catalog doctor (`doctor [--json | --report | --check-only | --cleanup]`): four flags, at most one; `--json`, `--report` and `--check-only` are read-only, `--cleanup` is the explicit interactive inventory of old PDD LaunchAgents, units and pocket helpers. `--check-only` must work on an Alpha-only install because the detached updater runs it for the candidate's self-check; client-owned checks are SKIP there. Catalog link.status (`link status [--json]`), link.restart, link.stop, link.logs, link.devices, link.revoke (`link revoke ID_OR_NAME`, one operand), link.uninstall (`link uninstall [--forget]`) and link.reset-identity, each with a help form; link.run (`link run`) is the service entry point and has no help form. Each route accepts only these options and operands; anything else is a usage error (exit 2). Behavior belongs to the [phone CLI](../phone/cli.prompt.md).

**Acceptance evidence.** This is a preserved Alpha module that the build updates in place. Its existing tests under `repo/test/` are the acceptance evidence; there is no separate Story or cases file. The P1 command routes in [pdd-cli](pdd-cli.prompt.md) are the complete list of new commands and options.
