# Retire the legacy global npm PDD entry

Own `launcher/npm-cleanup.mjs`. This installer-only behavioral extension removes
an identified old global npm Alpha so it cannot shadow the managed PDD shim.
Module function `cleanupLegacyNpm(ports = {})` returns `true` after removal or
`false` when no matching package is identified. Ports optionally supply `env`,
`stdout`, the selected absolute `node` (defaulting to this process executable),
and the Node-style async `execFile(file, argv, options)` command edge.
It does not execute the `pdd` found on PATH or touch Python installations.

Resolve npm once from the original invocation PATH, then use that npm's global
root for its invocation environment. Remove only the global
package named exactly `pdd` whose package.json identifies repository
`promptdriven/pdd_alpha` (GitHub shorthand or the equivalent HTTPS/Git/SSH URL,
with optional .git suffix). Missing npm or package, unreadable/malformed metadata,
and any other package identity authorize no uninstall. Do not search other
prefixes or infer identity from executable names. Preserve unrelated global npm
packages, Python pdd-cli, PDD state, services, native sign-ins and user files.

For a positively identified package, run one global npm uninstall of `pdd` with
lifecycle scripts disabled and offline/no-audit/no-fund settings. Use argv, never
shell evaluation; keep npm's existing prefix selection. The already selected
absolute Node may be supplied to npm's child PATH; never install Node or npm for
cleanup. Do not use sudo or pip. Failed npm inspection (apart from missing npm)
or a failed requested uninstall gives `legacy_npm_cleanup_failed`, no success
line and no retry. Inherited npm dry-run configuration must not turn cleanup into
a simulation: explicitly disable dry-run for the child. An exit-zero command
is insufficient evidence; confirm that the identified package directory is absent
before returning true or printing success. A retained directory or an unreadable
removal result gives the same failure, with no retry. Successful uninstall prints exactly one line:
`Removed old global npm pdd (promptdriven/pdd_alpha).`

The verified installer invokes this only once a managed runtime and stable
launcher exist: the fresh bootstrap completes publication/support first; an
existing managed installation uses its retained support Node. Cleanup does not
upgrade the retained release. Setup still owns its consents and result.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): authoring.
- Runtime: Node filesystem/child-process/path facilities and optional local npm.
  No private module, hosted service, package download or registry call is required.
