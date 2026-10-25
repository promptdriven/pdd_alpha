# Public machine diagnostics

Own `src/doctor.mjs`. Draft for review; behavioral refinement of the existing
doctor result/output contract, extended with Alpha-only self-check and explicit
legacy-tool cleanup. Report local health and repair steps without depending on
the private client. Do not repair anything during a diagnostic read.

The public module function `runDoctorCommand(argv, deps)` returns a Promise of
integer exit code and never throws. It runs `pdd doctor` with at most one of
`--json`, `--report`, `--check-only`, `--cleanup`; argv excludes the word doctor.
Unknown flags, operands or combined modes give usage on stderr and exit 2 before
checks, private loading or effects. Public Alpha owns this binding. The optional
client supplies its checks through a caller-provided adapter, never a mandatory
private import. Helpers and check scheduling remain implementation choices.

<details>
<summary><strong>Checks, output, exit codes and client absence</strong></summary>

Each check is `{id, state:pass|fail|skip, detail, next}`. A failed check has one
actionable next step; pass/skip has next null. SKIP always explains the unavailable
or inapplicable capability. Stable check ids identify facts across text and JSON.
One failed/unavailable check never hides the remaining independent checks.

Read Alpha's resolved runtime/module closure, owned Node identity, install phases,
retained-runtime readability, local disk, relevant native tool versions/hooks,
PATH precedence and local service/Herdr state through documented read-only ports.
Absent optional native tools or platform-specific checks can skip with a reason;
a missing/corrupt required candidate module or runtime is fail, never a skipped
self-test. Import the candidate public modules under the selected Node and run
their local, pure discovery self-checks before passing the module check. Reading
source text is insufficient. Import every present top-level public src/*.mjs module;
let the native module loader resolve static dependencies. Optional dynamic client/update
adapters are not required by Alpha and are never imported by this check. Syntax errors, import-time throws, missing required
exports and invalid bundled guidance/definitions fail. Check the candidate entry
syntax without running a CLI operation. This isolated check has no network,
subprocess, write, private-module or native-sign-in access; its output is never
dumped as a diagnostic. No check starts Herdr, Link, agents, services or an installer.

With no client installed, client-owned service, relay, membership, provider/cache,
vault and keeper checks are SKIP: "Client not installed." Alpha checks still run.
An installed client with an unavailable required self-check adapter fails the
client self-check rather than silently skipping a broken candidate. The optional
adapter module function `doctorChecks({mode})` returns
`Promise<{checks, report}>`; mode is `text|json|report|check-only|cleanup`.
`checks` is the row array above. `report` is optional and holds only
`versions`, `installPhases`, `accountStates`, `expiries`, `lastGoodAt`,
`diskFreeBytes`, `logLines` as applicable; omitted facts remain unavailable.
The adapter cannot write files or emit raw credentials. Validate/redact its results before
printing. Adapter failure becomes a failed check and does not throw out of doctor.
Client checks may describe the machine/tool account setting and per-tool launch
defaults as redacted local facts. Doctor offers no agent/run account setter or
project selector. It must not infer valid model/effort combinations from a bundled
table; capability discovery belongs to each machine's native CLI adapter and is
not performed by the local-only candidate self-check.

Default text prints `PASS|FAIL|SKIP <id>: <detail>` and one `  Next: <next>` line
after each failure. `--json` prints exactly one JSON line `{ok,checks}`. `ok` is
true iff there are no fail checks, including an Alpha-only result with explicit
client skips. Exit 0 iff ok, else 1. Keep stdout for results and stderr for usage
or a finite top-level diagnostic. Never print a raw exception or secret-bearing
subprocess output.

</details>

<details>
<summary><strong>Read-only self-check and redacted support report</strong></summary>

Default, JSON, report and check-only write nothing. `--check-only` reads only local
candidate state and the same local schemas used by normal diagnostics: no network,
sign-in, refresh, native-model call, migration, repair or service-manager mutation.
Remote reachability checks are SKIP with a reason in this mode. It must work from
the candidate's verified temporary paths under its selected owned Node. The updater
separately owns credential-helper output comparison; doctor reports redacted
results only. Never read stock native sign-in files.

`--report` writes its redacted support report to stdout, never uploads or saves it.
Include versions, install phases, account states/expiries when the client provides
them, lastGoodAt, free disk and at most 200 redacted local log lines. Exclude tokens,
private keys, stock auth, message/screen text, invite/pairing links, approval proofs
and push endpoints. Omit a line/fact whose safe redaction cannot be established. Report check details
and next steps are rendered from local diagnostic vocabulary, never adapter free
text. Unrecognized check ids use the label client-check. The support adapter's
structured report fields have the following printable projection:

- versions: only node, pdd, alpha, client, codex, claude and herdr keys; render
  the numeric major.minor.patch of a valid version, omitting any suffix.
- installPhases: known install phase values, either a phase string or values
  under transaction, staging, current and previous keys.
- accountStates: codex, claude and github keys with known account states
  (ready, unavailable, full, waiting, needs_signin, auto, fixed or Auto).
- expiries: codex, claude and github keys containing nonnegative finite epoch
  timestamps. lastGoodAt and diskFreeBytes are nonnegative finite numbers.
- logLines: structured records with event check.completed, check.failed,
  runtime.checked, install.observed, account.observed or service.observed; optional
  at is a nonnegative finite timestamp, state is pass/fail/skip, and checkId is a
  known local diagnostic id. Render only those supplied facts with local labels.
  Free-form string log lines are omitted, including apparently safe prose.

Keep at most 200 rendered log records. A credential-shaped value, unknown key,
unknown state/event or unproved free-text value grants no printing permission.
Unknown report fields are not permission to dump raw adapter data. Use the same
health exit rule as other read modes; missing optional facts remain explicit skips.

</details>

<details>
<summary><strong>Explicit per-item cleanup</strong></summary>

`--cleanup` inventories old PDD LaunchAgents, user units and legacy pocket helpers.
It requires an interactive terminal before any cleanup effect; otherwise exit 1
with the step to rerun interactively. Show each exact owned item, current state and
the proposed effect; offer keep, unload or remove as applicable. Keep is always
available and is the default for cancellation, EOF or an unanswered choice.
Inventory alone grants no cleanup permission. Never select a service by process
name, stop an agent/controller/Herdr, remove live referenced work, read native
sign-ins or alter unrelated tool configuration.

Only a fresh explicit per-item choice authorizes unload/remove. Recheck ownership,
identity and live references before that effect; a changed or uncertain target is
retained with a failure/next step. Cancellation retains unprocessed items and does
not roll back completed explicit choices. Report each result without retrying a
failed destructive effect. Exit 1 for an attempted failure or unresolved required
check, else 0; keeping an item is successful. This flag is never used by bootstrap
continuation or a staged-version self-test.

</details>

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): authoring.
- [Versions](versions.prompt.md) and [install record](install-record.prompt.md):
  required for generation/runtime; authoritative Runtime and install-state shapes.
- [Story](../../story/cli/DOCTOR.md) and [cases](../../vectors/cli/doctor.json):
  verification; independent expected results, not implementation observations.
- Runtime: Node filesystem, safe argv-based read-only OS probes, terminal/stdio,
  optional client doctorChecks adapter and explicit cleanup inventory/choice ports.
  Client absence is supported. Dispatcher and phone-adapter wiring are caller
  integrations, not private dependencies of this module.
