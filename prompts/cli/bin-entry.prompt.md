# PDD executable entry

Own `bin/pdd.mjs`. Draft for review. Behavioral refinement: keep executable name
`pdd`, argument order, cwd, native environment, stdio, signal/exit behavior and
the local dispatcher contract. Extend ordinary npm/npx entry to use an existing
managed installation's pinned runtime. Do not overwrite live package files.

Before importing a command dispatcher, choose one runtime. Ordinary package/npx
invocation with a managed install hands off to the resolved current runtime's
absolute Node and bin. The requested npm dist-tag is not authority to bypass it.
A process explicitly started with a recorded run runtime stays on that runtime;
it never resolves current. No managed install: use this package's own local
`runPdd`. Help, version and unsupported syntax still belong to the dispatcher;
entry selection never invents a command or launches a private adapter.

<details>
<summary><strong>Required binding, loop guard and failure behavior</strong></summary>

The module function `runPdd(argv, ports?)` belongs to `src/pdd-cli.mjs` and returns
an integer asynchronously. Pass `process.argv.slice(2)` unchanged and assign its
result to process.exitCode. At the selected managed dispatcher, supply the exact
resolved Runtime as `runPdd(argv, {ports: {runtime}})`. Preserve descriptor
extensions and the selected version even when current changes; this handoff lets
workflow preparation freeze its verified runtime. An uninstalled entry supplies
no runtime, leaving the runner's immutable-runtime refusal intact. Do not derive
a descriptor from environment flags or replace a missing one with current.
On handoff, execute an argv array without a shell,
preserving cwd, inherited stdio, environment and child exit/signal semantics.
A path or argument containing spaces/metacharacters stays one argument.
In particular, preserve `pdd session --project <part of name>` and `pdd projects`
through handoff. The dispatcher owns project-name resolution and errors; this
entry does not turn a name into a folder path, choose an account, discover a
model/effort list or inject launch defaults.

Compare real entry/runtime identity to avoid recursive handoff. A bare environment
flag is not proof of a pinned run: use a validated recorded runtime from the
runner's saved invocation, or the fact that the absolute invoked entry is already
inside that explicitly selected complete version folder. The target does not
handoff again just because current changed after its launch. No repeated current
lookup in one process. A broken managed pointer/record/runtime fails with
`runtime_unavailable` and one repair step; never silently fall back to the newer
npx package. Recovery is through the stable install launcher, not a speculative
command dispatch. Ordinary uninstalled checkout use continues to work.

Do not install services, read credentials, sign in or mutate project files during
entry selection. The bootstrap and dispatcher own explicit setup/update effects.

</details>

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): required for authoring.
- [Versions](versions.prompt.md): required for generation/runtime; installed
  Runtime resolution and pinned identity.
- [CLI dispatcher](pdd-cli.prompt.md): required for generation/verification;
  owns runPdd and supported command behavior. This entry adds no command policy.
- [Story](../../story/cli/BIN-ENTRY.md) and [cases](../../vectors/cli/bin-entry.json):
  required for verification, including the [runtime handoff cases](../../vectors/cli/bin-entry-runtime.json).
