# Story: one installed command runtime

Draft for review. As a person using pdd through npm or npx, I want commands to use
the installed machine runtime while a saved run continues with its own version.
The [contract](../../prompts/cli/bin-entry.prompt.md) owns executable handoff.

- **AC1:** With no managed install, the package calls its local runPdd with the exact
  argument array and preserves returned exit code. Ordinary checkout use works.
- **AC2:** Ordinary npx invocation with a complete managed install hands off once
  to current's absolute Node/bin before loading the fetched package's dispatcher.
- **AC3:** An explicitly pinned run entry remains on its recorded runtime even
  after current changes. The entry never combines code from two folders.
- **AC4:** Broken managed state produces runtime_unavailable and a repair step;
  it does not execute the fetched package instead. An environment flag alone
  cannot claim run pinning.
- **AC5:** Handoff preserves cwd, argv boundaries, native environment, stdio and
  exit/signal behavior. Entry selection creates no services and reads no credentials.
- **AC6:** Project-name session arguments and the projects command cross handoff
  unchanged. The entry keeps the caller's cwd and delegates name/model validation
  to the dispatcher, adding no account selection or launch default.
- **AC7:** The selected managed dispatcher receives its complete verified Runtime
  through existing CLI ports, including extensions, so workflow preparation can
  freeze that version. A saved older entry keeps its runtime after current moves.
  Missing or invalid runtime cannot gain authority from the handoff.

[Cases](../../vectors/cli/bin-entry.json) are independent expected behavior, not
observed CLI execution.
