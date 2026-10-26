# Local PDD Alpha command boundary

PDD Alpha supplies a guide and recipes for the user's existing coding-agent conversation. Keep `pdd` as the command name. Provide local discovery without hosted-service commands or private dependencies.

The local command surface includes help (root and known local command help), `--version`, `--skill`, `workflow list [--json]`, `completion bash|zsh`, `session [--agent codex|claude] [request text]`, and `workflow feature|bug|small-change [--agent codex|claude] [request text]`. Unknown or excluded commands, including with help flags, refuse clearly with exit2 before effects. Do not look up installed service adapters, forward arbitrary argv, import private dependencies, implement authentication, make PDD service calls, change accounts or install services other than the opt-in PDD Link user service described in [Phone and Link](#phone-and-link). Public local workflow run/resume may use ordinary authenticated Git/GitHub tools through the distinct runner. Expose only supported local command declarations and validators.

Keep one catalog authoritative for help/parser/completion. Parse before local reads. Success returns0; unsupported syntax2; missing guidance/local filesystem failure1. Do not echo untrusted input. Local discovery reads do not create project files. Explicit session launches only the installed native Codex or Claude; native keeps the user’s existing environment/login and follows their conversation instructions. Full-access launch arguments are owned by [native launch flags](native-flags.prompt.md) and used by [native session](native-session.prompt.md) and [workflow stage transport](workflow-stage-herdr.prompt.md); no global permission or configuration rewrite is performed, except the consented writes in [Phone and Link](#phone-and-link). No hosted workflow service or fallback. Package metadata/lock must be dependency-free, retain bin `pdd`, include complete docs/skills/recipes/example and avoid lifecycle scripts. Source use and private temporary package-consumer tests are supported; registry publication/global installation are outside scope.

## Dependencies

Read the entire [Prompting guide](../../docs/prompting-guide.md) before authoring prompts or Stories. Source files implement these contracts; tests exercise observable behavior from the actual packed package.

Named workflow shortcuts select exactly one bundled manual recipe and use the same ordinary native launcher. This is one conversation, not a managed or stage-separated runner, and no PR effect is automatic. Existing session still loads all bundled recipes.

Workflow execution uses `pdd workflow run NAME ISSUE [--agent codex|claude]` and `pdd workflow resume RUN_ID [--decision approve|skip]`. DISTINCT local runner owns durable journals, saved agent/identity, human choices, handoff/test completion and real GitHub PR effects. CLI parses/dispatches and supplies existing guidance/native ports, never duplicates that policy. Resume without decision is inspect/reconcile/wait only. No user-supplied native-argument passthrough, hosted engine or auth/provider gate; the read-only `workflow status` and the other P1 routes are defined in [P1 command routes](pdd-cli.prompt.md#p1-command-routes). Direct shortcuts are one-conversation companions, not the runner.

## Workflow decide

The surface adds `pdd workflow decide RUN_ID --decision approve|skip --id DECISION_ID --expect-stage STAGE --expect-seq N [--json]` and resume's optional `--id`, `--expect-stage` and `--expect-seq`. Decide only reads run records. It opens one new tab in the person's default Herdr session and types the absolute-path resume line there. It never starts Herdr, never runs a controller as its own child and never writes the journal.

## Phone and Link

The surface includes `pdd phone [--relay URL] [--name NAME] [--codex PATH] [--claude PATH] [--no-integrations]`, `pdd doctor [--json | --report | --check-only | --cleanup]` and `pdd link status|restart|stop|logs|devices|revoke|uninstall|reset-identity|run`, owned by the [phone CLI](../phone/cli.prompt.md). Only `pdd phone` and `pdd link` install, restart, stop or remove the per-user PDD Link service (launchd / systemd --user) and its files under `~/.pdd/link/`. Link is opt-in, listens on no network port and connects out only to the relay URL the person gives. The relay is a separate package outside the npm `files`; pdd calls no hosted service.

`pdd phone` asks one consent question before it runs `herdr integration install` for each agent kind that needs it; it lists what Herdr writes (`~/.codex/hooks.json`, `[features] hooks = true` in `~/.codex/config.toml`, and the Claude hook). It asks a separate consent question before it sets Herdr's `[terminal] default_shell` to the PDD pane shell; `pdd link uninstall` restores the previous value. `--no-integrations` skips the first question. `pdd doctor` changes nothing. These are the only native agent and Herdr configuration writes pdd makes.

**Acceptance evidence.** This is a preserved Alpha module that the build updates in place. Its existing tests under `repo/test/` are the acceptance evidence; there is no separate Story or cases file. The P1 command routes in [pdd-cli](pdd-cli.prompt.md) are the complete list of new commands and options.
