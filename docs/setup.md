# Local source setup

Open a terminal at this source repository's root. Use Node.js 22.16.0 or newer. Git is required for issue workflow runs; authenticated GitHub CLI (`gh`) is also needed to bind the actual issue/repository and perform PR stages. This package has no dependency-installation requirement for its CLI or tests.

```sh
node bin/pdd.mjs --help
node bin/pdd.mjs --version
```

Use these local invocations to avoid replacing an existing global `pdd`. PDD requires no enrollment or hosted-service setup. For the local native session launcher, have `codex` or `claude` installed on PATH and use its normal account/provider access. See official [Codex CLI](https://developers.openai.com/codex/cli/) or [Claude Code](https://code.claude.com/docs/en/overview) setup only if needed; an already usable agent needs no new login. The launcher preserves cwd and native login while starting agents in full-access mode without approval prompts. Codex uses --no-daemon, --dangerously-bypass-approvals-and-sandbox and invocation-only trust for the exact cwd; Claude uses --dangerously-skip-permissions. PDD does not copy credentials or write global agent configuration.

Once your installed native agent is ready, use `node bin/pdd.mjs session --agent codex` or `node bin/pdd.mjs session --agent claude` from the package root. The full canonical guide, skill and manual workflow content are supplied automatically before Story authoring.

Before PR stages, the project needs a GitHub `origin` and the local `refs/remotes/origin/<default-branch>` commit ref. PDD does not fetch missing refs.

Public `pdd setup` checks for [Herdr](https://herdr.dev/) on the invocation PATH and, if missing, uses its official installer. Setup reports failure until the installed executable is actually on that PATH; it does not edit shell profiles. Follow the printed PATH instruction and rerun setup if needed.

For issue execution, use compatible Herdr in the intended normal-user context. `workflow run` and `workflow resume` check the `default` Herdr session after preparing the saved run. If stopped, they request one bounded headless start through the Linux user service or a detached macOS process and wait for an actual response. Failure gives an actionable message; readiness alone does not prove a controller or native stage started. Herdr 0.9.1 is the capability baseline; owned target server/API compatibility is checked, without auto-upgrade or shared restart. Background native lookup/login/settings follow that server and its backing shell startup, not necessarily the later PDD invoker environment. No environment/token/auth copy is used to force a match.

Read [local workflow guidance](workflows.md) before `pdd workflow run NAME ISSUE`: it allocates an issue worktree/branch and can push/create real PRs. Keep its PDD controller running for background-stage progression; use saved-run resume after controller exit and `workflow attach RUN_ID` for the current active native stage.

Follow the [conversation guide](prompt-sessions.md) to load the complete Prompting guide before authoring. Use the [example](../examples/ticket-status/README.md) to inspect a complete local contract and code-test path. See [contribution guidance](../CONTRIBUTING.md) for optional package inspection.
