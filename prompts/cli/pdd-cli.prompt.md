# Local authoring-kit CLI

Own `src/pdd-cli.mjs`; export `renderHelp(prefix)`, `runPdd(argv, dependencies)` and async
`createPddCliPorts(ports={}, {capability,...options}={})`. Help, version, guidance, completion and recipe discovery operate using public local files only. Parse before reading guidance or workflows; unsupported input gets a finite stderr diagnostic/exit2 and no private fallback.

**Preservation:** behavioral refinement of the existing command invocation,
stdout/stderr and exit contracts, with the explicit P1 routes below added;
internal dispatch and module loading are free within the no-effect discovery rule.

`--skill` must make the entire canonical `docs/prompting-guide.md` available FIRST, then `skills/pdd/SKILL.md` and every Markdown reference under `skills/pdd/references/`, with installed absolute file locations so other bundled docs and recipe links can be read in the same package. Do not duplicate or rewrite the guide on disk. Tell the agent to read all of it and summarize the relevant method BEFORE ANY Story drafting. A link or claimed schema check is not loaded guidance. Read the required files before printing success; missing/unreadable guidance returns1 without claiming a complete bundle. References are sorted deterministically and ordinary regular files only; do not follow symlinked reference directories/files.

Use the package-root metadata version. For `--version`, print only that version followed by one newline, without the package name or any prefix. `workflow list` inspects the caller's project only; it does not execute or install recipes. Preserve stdout for successful values and stderr for errors. Explicit session invokes the public native-session launcher with full bundled guidance and the parsed user request; native inherits the existing environment and terminal. Keep imports and injection defaults self-contained, with no private transport/backend dependency.

## Production composition at the CLI entry

`createPddCliPorts` is the public module factory used by `runPdd` for the
requested capability, never a second runtime or lifecycle policy. Supported
capabilities are `models`, `projects`, `controller` and `keeper`. Construct only
the requested factory after parsing and only when that command needs it;
help/version/guidance/completion must not probe executables, services or clients.
Unknown capability requests fail without constructing anything.

For `models`, return explicitly supplied `modelPorts` unchanged, otherwise call
`workflow-models.createLocalWorkflowModelPorts` with actual selected cwd,
machineId, Settings and invocation environment. For `projects`, preserve
explicit `projectPorts`, otherwise call
`workflow-projects.createLocalWorkflowProjectPorts` with actual cwd/home,
machineId, Settings and the optional explicit run-index reader. These real
factories own discovery, protocol parsing and local identity; caller ports are
not a substitute for a default production implementation. Resume and drive also assemble model ports before runner reconciliation so
frozen selection validation has a real catalog/defaults provider. Explicit
caller nativeCatalog/toolDefaults references remain authoritative. Explicit local
factory options remain supported and take precedence over environment defaults.

For `controller`, lazily compose the actual controller factory with the complete
same caller ports object; preserve explicitly supplied Herdr, OS identity,
observer and authority references. An explicitly injected legacy controller
without that factory retains its original ports path. For `keeper`, use the
keeper module's actual `createWorkflowKeeperPorts`, including its explicit
fleet-client conditional providers.
An explicitly injected keeper keeps the existing no-unused-transport seam.
No CLI factory invents quota, managed-launch records, process proofs or journal
facts. Preserve Rule 11's PDD_TRACE propagation, safe failed-call diagnostics,
frozen runtime, PID/start identity and launch/generation matching, start/lifetime
locks, no-repeat and unknown inspect-only behavior.

A fleet-only route with no production client binding must terminate with a
finite stderr diagnostic containing the literal phrase `this needs the fleet
client`. Never silently skip an effect, report a conditional operation complete,
or load private modules in the public Alpha package. Public setup remains
valid without a fleet client: it provisions only the verified public recovery
support; absence does not turn that public success into fleet setup success.
Explicit optional client bindings remain supported, with actual exit codes and
supplied references preserved; they cannot supply missing authority by name alone.

## Workflow routing

For a named workflow plan, use the existing session branch/native launcher with workflowName selecting only that provided recipe. No new process/approval/permission/transport path. Session without a named recipe retains all-recipes context.

Workflow preparation, pane drive, reconciliation and attachment use the distinct
public runner exports declared below. Load the four existing stage transport functions plus the explicit resumeHerdrStage recovery function
only for a drive/attach that needs them, preserving ordinary guidance/native
ports. The CLI never constructs stage context, journal state or agent identity.
All optional placement and machine/tool policy ports are supplied explicitly; no private fallback.


Print the actual returned message ONCE, never dump result objects/private DTOs; return exitCode. Runner-owned mapping completed0, waiting2, failed/recovery_required1; pass the actual exitCode unchanged; waiting is not completion or pass. Missing module/export, invalid result or thrown failure is finite1 with no retry/private fallback. No native0-as-completion inference, direct journal/GitHub/approval action, same-command implicit resume or CLI-owned stage progression. The runner's explicit drive owns identity/reconciliation/decisions. Existing guidance/native APIs/process behavior unchanged.

Help must distinguish manual/session recipe use from the explicit local workflow run/resume stages and actual PR effects, not claim the whole package never runs workflows.

Bind the four existing workflow-stage-herdr exports plus resumeHerdrStage into workflow
run/resume/attach ports alongside unchanged
loadGuidance/launchNativeSession/stdout/stderr. Test injection may supply this transport
module, no public flag.

Public `workflow attach RUN_ID` invokes existing main
`attachWorkflow({runId,cwd,packageRoot},ports)` and uses the same
returned-message-once/actual-exit contract; CLI does not resolve journals/agent IDs or
start a conversation on archived history. Workflow run/resume prepares or reconciles the
saved run, then lazily calls module function `ensureDefaultHerdr(ports)` from
`src/workflow-herdr-boot.mjs` with the complete existing ports before requesting
a controller pane through the public launch helper. A non-prepared result, remote
dispatch, discovery or drive/attach never invokes this startup helper. A supplied
`workflowController` keeps its existing injected path unless an explicit
`workflowHerdrBoot` module is also supplied. An unavailable or invalid startup
reply exits 1, prints its safe actionable failure once on stderr and never calls
the controller; a thrown startup failure gives fixed Herdr startup guidance.
Readiness is only a prerequisite. After it, lazily await the controller module's
`createLocalWorkflowControllerPorts(ports)` when exported, then pass its composed
ports to `startWorkflowController`. This factory owns the real public Herdr
client plus existing strict runner authority; it preserves supplied bindings.
An injected controller without a factory retains the existing unchanged ports
path. Drive lazily binds the same public client's `readProcessStartIdentity`
over complete ports only when that callback is absent. No CLI identity encoding,
private authority or raw-stat fallback. None of this overrides an
unsupported-platform refusal or replaces controller identity, lifecycle, lock or
durable generation proof. Stage
agents use panes in that run tab.

When controller start is `uncertain` or lacks a definite refused/failed result, exit 1 and print `Workflow controller may be running: STATE (CODE). Check pdd workflow status RUN_ID.` followed by any known missing-Herdr explanation. Do not say not started or suggest relaunching that run. For a definite refused/failed result, exit 1 and print
`Workflow controller not started: STATE (CODE).` once on stderr, followed by
`Inspect the saved run before retrying.` Preserve the actual returned state and
code, including unfamiliar codes; strip terminal control characters, use
`unknown` for missing/empty values, and render an explicit null code as `null`.
For `herdr_identity_unavailable`, append the fixed safe explanation
`Herdr process identity is unavailable for the new controller pane. No controller command was sent.`
Do not print arbitrary result messages or infer a cause for other codes.
If the result supplies `missingPorts`, include `Missing ports: NAME, NAME.` for
its nonempty identifier names (letters, digits, underscores and dots, starting
with a letter). Do not infer missing dependencies from `unsupported`, dump the
result/message/private DTO, probe capabilities again, retry or weaken a guard.
The existing started message/exit 0 and thrown-failure diagnostic stay unchanged.

Help must explain that human waits stop the controller and require a current decision;
local recovery reconciles stopped non-human work. Session and direct conversation
shortcuts remain foreground with existing native settings. Stage agents must not
terminate the controller. Native readiness is never acceptance; the keeper alone
reconciles eligible stopped controllers.

workflow list delegates to authoritative listWorkflowDefinitions({cwd,packageRoot}), producing {workflows:[{name,source}],default:null}; no native/runner start. Use dynamic loader import (injectable in tests), no duplicate schema or silent fallback to legacy Markdown-only files. Invalid/missing loader returns finite1. Local help/version/skill/completion rendering do not import or call loader/backend unnecessarily.

## Help contract

The first help line is exactly `PDD: prompt-driven development for your coding agent.` Root, workflow group and exact workflow run/resume/attach help describe the commands without preview labels or a claim that real workflow PRs are unproven. Retain command syntax, the real push/PR side-effect warning, pane controller/current decision and explicit resume and saved active attachment facts. Help is exit0/local, with no runner/native/loader/network/auth effects and no added refusal, gate, flag or success claim.

## Workflow decide

`workflow decide` calls `decideWorkflow` from the distinct [`src/workflow-decide.mjs`](workflow-decide.prompt.md), imported dynamically and injectable in tests. With `--json`, print one stdout line: the result without `exitCode`, plus `v: 1`; otherwise print the message once. Return the result's `exitCode` unchanged. A missing module, an invalid result or a throw gives exit 1 with no retry. `workflow decide` maps `--rev` to `expectedRev`; retain the legacy expected stage/seq pair. Drive/resume map `--id` to `decisionId`, `--rev` to `expectedRev`, and the legacy pair to `expect: {stage,seq}`. A revised human wait never resumes without its current revision.

## Phone and Link

When the optional client command adapter is installed, `phone` calls
`runPhoneCommand(argv.slice(1), deps)` and `link` calls `runLinkCommand(argv.slice(1),
deps)` through the supplied optional client adapter described by the [phone
CLI](../phone/cli.prompt.md), injectable in tests.

An Alpha-only install imports no private file; unavailable client commands return a
finite unsupported result. `doctor [--json | --report | --check-only | --cleanup]` binds
the public Alpha module function
`src/doctor.mjs:runDoctorCommand(argv.slice(1),deps)`. It returns 0 when applicable
checks pass and 1 when any fails; client-owned checks are SKIP with a reason when the
client is absent.

The public updater can therefore run doctor --check-only without a private import. The
doctor module is alpha-a's contract; this CLI does not implement its checks. Root help
lists public doctor plus optional phone/link; local discovery imports none of them.


## Public setup and recovery

`setup [--no-phone]` first resolves its verified runtime using the existing
versions owner; a failed runtime resolution performs no Herdr installation.
Then call public module function
`ensureHerdrInstalled(ports)` from `src/workflow-herdr-boot.mjs`, passing the
complete existing ports. Only its `ready` reply permits recovery provisioning;
an unavailable/invalid reply or throw exits 1 with safe actionable Herdr guidance,
without recovery or optional-client effects. The helper owns supported
installation and actual invocation-PATH proof; installer exit 0 alone is not
setup success. No CLI profile, environment, sign-in or integration-hook mutation.
Test dependency `workflowHerdrBoot` may explicitly supply the same two helper
exports; production loads the real public module lazily.

Then provision Alpha's public runs-keeper recovery service,
without importing or requiring the client. Resolve the verified runtime from the
explicit packageRoot with `src/versions.mjs:resolveRuntime({home,versionRoot})`.
Hold `src/update-lock.mjs:withUpdateLock({home}, action, ports)` while the action
calls `src/pdd-launch.mjs:installLauncherSupport({home,runtime,lease}, ports)` and
then `provisionRecoveryService({home,runtime,lease}, ports)`. Each launcher result
must have code null before the next effect. These public owner interfaces supply
the stable service paths and equal-file preservation; the CLI defines no service
text or second recovery policy. A missing verified runtime/module/lease gives
finite exit 1 with the public install/recover next step, never a client requirement.
On public setup success, an explicitly supplied client's runSetupCommand may
continue optional fleet/tool setup with the original argv. With no client, report
public recovery ready and exit 0. Do not perform an account sign-in or erase
settings in the public step. Discovery/help never loads these effect modules.

## P1 command routes

Add only these routes to the existing parser/catalog contract:

| Command | Public module binding and outcome |
|---|---|
| `workflow run NAME ISSUE [--agent codex|claude] [--on auto|MACHINE] [--model MODEL] [--effort EFFORT]` | Placement selects first. Local: runner `prepareWorkflow` prepares once, then controller `startWorkflowController`. Remote: persist startId/target/task binding, dispatch once; target prepares with that same runId and launches there. Never prepare a source-side remote worktree. Return started only with durable target/process proof. |
| `workflow drive RUN_ID [--decision approve|skip --id UUID --rev N]` | Runner `driveWorkflow`; controller pane entry, actual completion/wait/failure result and exit code. Existing expected stage/seq options remain accepted. |
| `workflow resume RUN_ID [--decision approve|skip] [--id UUID] [--rev N] [--expect-stage STAGE --expect-seq N]` | Reconcile the original; absence of decision grants no new effect. Preserve legacy decision options subject to current revision checks. A launch uses saved runtime and the same controller helper. |
| `workflow decide RUN_ID --decision approve|skip --id UUID --rev N [--json]` | `decideWorkflow`; legacy expected pair remains supported. Journal record, not launch acknowledgement, completes the decision. |
| `runs-keeper` | Public `runWorkflowKeeper({home},ports)` service entry installed by setup; real service lazily composes the same controller factory first, with no private client or fleet sign-in. An explicitly injected keeper module retains its supplied ports path. Keeper owns its lifetime lock, locator validation and reconciliation. |
| `workflow adopt RUN_ID` | Runner `adoptWorkflow`; validation/registration only, no launch or approval. |
| `workflow clean [--dry-run]` | `cleanWorkflowRuns`; prints removed and retained runs/reasons, never discards unpushed work. |
| `workflow attach RUN_ID` | Existing `attachWorkflow`; current active stage only, finite archived result. |
| `workflow status [RUN_ID] [--json]` | Read-only: `readRunIndex`, `readRunStatus` and `readJournalLast` from [run records](workflow-run-records.prompt.md); those three readers are the complete persistent read set. Shows project name, machine, step, version, actual account, machine/tool policy revision and switch progress, model/effort, WAIT, `runtimeNotice` and Needs you with the current `rev`. Never advances a run or starts a controller. |
| `workflow upgrade RUN_ID` | The explicit Upgrade run from [frozen runtime](workflow-runtime.prompt.md): a recorded transition at a stopped stage boundary with the current wait revision. Shows old and new runtime and asks before recording. Calls runtime module function `upgradeWorkflowRuntime({runDir,expectedRev,target},ports)` with the current reviewed revision and verified target. Only the controller journals the upgrade; it starts no agent. |
| `models [--on MACHINE] --agent codex|claude` | `listWorkflowModels({machineId, agent}, ports)` from [machine CLI models](workflow-models.prompt.md); prints the visible models and each model's accepted efforts with the source machine. An unavailable catalog exits 1 with a retry step. Changes no default; starts nothing. |
| `settings [KEY VALUE] [--machine MACHINE] [--tool codex|claude]` | Reads or writes the machine settings the phone Settings page shows: `model` and `effort` (require `--tool`; validated with `resolveWorkflowModel` before the write; a changed model keeps the old effort only when that model supports it, else its observed default), `projects.base`, `auto-switch-my-sessions`, `auto.order`, `alerts`, `alert-text`. Account keys belong to `pdd accounts`; update keys to `pdd update`. No key prints without a value and no value is written without a validated pair. Help text in `spec/cli/COMMANDS.md`. |
| `update [--check | --now | --to VERSION | --pin PREFIX | --unpin | --rollback | --mode auto|ask|never | --channel stable|beta] [--fleet] [--force]` | `runUpdateCommand({action, value, fleet, force}, ports)` from the supplied update module, or the self-contained [public update command](update-command.prompt.md). At most one action; `--force` needs `--to` or `--rollback`; a second action is exit 2 before effects. A plain local show always exits 0, prints current, previous, target, mode, channel and pin with explicit unknowns, and performs no update or repair. An absent/failing adapter falls back to public local status with a plain reason (preserve a supplied nonzero result's user-visible message); never imply that availability was checked. Default public commands do not import the excluded machine selector; check/change requests explain the absent binding without claiming success. Preserve a supplied adapter's non-show result/code; exceptions and invalid results get a fixed plain reason (known read/permission/network codes when available), never raw errors or just "unconfirmed". `--fleet` sends the same request to every member through the Link and prints each machine's result; offline machines stay pending. |
| `status` | Read-only. Prints Needs you first (account repairs, quota questions, joins, rollback notices), then agents and runs with each run's revision and review action. Alpha alone composes it from `readRunIndex` and `readRunStatus`; with the client adapter it adds the `fleet.status` result and the machine/tool account readiness through `runStatusCommand(argv, deps)`. Offline machines keep their last state with its age. |
| `fleet <command>` | Client adapter only: `runFleetCommand(argv.slice(1), deps)`; `status` prints the [ledger](../fleet/ledger.prompt.md) `fleet.status` result, `approve CODE` runs [approvals](../fleet/approvals.prompt.md), `remove`, `admissions`, `tag`, `rename` and `set-endpoints` run their fleet owners. Alpha alone returns the finite unsupported result. |
| `agents [--search TEXT]`, `agent <command> AGENT …` | Client adapter only: `runAgentCommand(argv, deps)` from the [phone CLI](../phone/cli.prompt.md); the terminal form of the phone's agent actions. Alpha alone returns the finite unsupported result. |

The internal drive option `--launch-id UUID` maps to launchId; reject an
invalid/repeated value before effects. It binds process/journal launch proof
and is not human approval.

Parser errors are exit 2 before effects. `--on`, `--model` and `--effort` are
start-only; they cannot move an existing run or change its saved selection.
`--agent` selects the tool (default codex); accounts never select the tool.
Reject `--mode` and `--account` on session/workflow starts with exit 2 and
"Set accounts per machine and tool in Settings" before effects. Forward
optional machinePlacement and machine/tool policy ports to their public owners.
A machine/tool policy is Auto or one account; no launch form or saved request
contains an account preference. Cross-tool behavior comes from its separate
setting, ask by default.

## Named projects and launch selections

`projects` binds public module function `listWorkflowProjects({machineId},ports)`
from [project discovery](workflow-projects.prompt.md), printing project names,
source and availability (an empty catalog says "No projects found"). It lists
without cloning, launching or asking for a path. `session --project NAME` uses
`resolveWorkflowProject({machineId,query:NAME},ports)` from that module. A unique
name match selects its actual cwd; ambiguous names print the candidate labels
and return 2, no match returns 1, and an uncloned project returns 1 with a Projects
next step. No implicit clone.

Resolve a requested name in the source catalog before
placement, supplying its canonical repository identity. A remote target validates
its own local counterpart/cwd against that identity; a source project id never
authorizes a target folder. Ordinary session without --project preserves cwd.
The phone's New agent uses the same named catalog and preselects its last project;
its navigation and clone/create/browse actions belong to the phone owner.

Session and workflow starts accept optional `--model MODEL` and `--effort EFFORT`.
Resolve them through [machine CLI models](workflow-models.prompt.md) after machine
selection and before preparing a run or native effect. Read defaults for the chosen
tool on the chosen machine; validate the final pair against that machine's current
CLI list. Forward the accepted selection unchanged to the native launcher/stage.
A workflow freezes this pair once; it does not re-read model defaults per stage.
Use the model owner's `resolveWorkflowLaunchModel` launch availability rule when
its list is unavailable: Settings default or no model/effort flags, with exactly
one returned warning on stderr. This also applies to sessions with a Settings
adapter. Available catalogs still reject unsupported/hidden choices (exit 2) or
invalid defaults (exit 1) before native effects. No guessed list or raw error.
Remote requests carry model/effort overrides, never source-machine defaults or
account choices; the target resolves and durably records its effective pair before
its launch receipt. Source discovery/help does not query model catalogs.

A public install without a placement adapter supports local work and refuses every
explicit machine name as remote_unsupported, including a name equal to the source
machine id. Every explicit --on value passes through selectStartTarget; a matching
string is not fleet identity proof. Omitted --on keeps local behavior and --on auto
keeps the placement owner's no-client local rule. Native `pdd session` remains the existing foreground
conversation; placement may forward a remote session only through the same optional
port. Session guidance, login, full access and existing local shortcuts are preserved.

Short launch commands return one message and code 0 only for proved started;
uncertain/failed/refused launch is 1, syntax is 2. Controller results keep
completed 0, ordinary waiting 2, failure/recovery_required 1. JSON output is
only where explicitly declared. No launch message claims a stage/test passed.
Help/version/skill/completion are local and load none of these effect modules.
The optional client dispatch is loaded only when requested; Alpha-alone help,
native sessions, runner and recovery work without it. The optional adapter must follow the [managed invocation boundary](../accounts/wrapper.prompt.md);
this CLI must not turn unrelated typed native commands into managed starts.

## Workflow status output

`workflow status [RUN_ID] [--json]` uses only readRunIndex, readRunStatus and
readJournalLast for persistent reads. runStatusFromState is the pure fallback
projection. Resolve runDir from the index, not a repository scan or assignment
lookup. For each selected entry, compare status journalSeq with the last complete
journal record; use a matching valid status, otherwise derive from that record.
Unreadable state yields a finite unknown result with warnings, not a launch.
Never repair files, acquire a controller, fetch, contact a service or advance.

With RUN_ID, --json prints one status object with `v:1` and the run-record
fields; an unknown id gives exit 1 and `{v:1,runId,state:"unknown",
message:"Run not found"}`. Without RUN_ID, print `{v:1,runs:[status,...]}` using
index order; an empty index gives runs:[] and exit 0. Warnings are additive.
Without --json, print the same facts in human text, with ages. Status is a view,
never authority for a decision or proof that a process is live.

Upgrade asks for old/new-runtime confirmation before calling the runtime module
with the reviewed expectedRev. upgraded is exit 0; refused/recovery_required
is exit 1; malformed CLI syntax is exit 2. Current run input is rechecked under
the runtime owner's supplied guard. No CLI path writes journal bytes itself.


### Absolute Herdr binding

Setup retains the installation helper's absolute executable and, under the same
update lease before recovery provisioning, calls
`recordHerdrRuntime({home,runtime,herdr,lease},ports)` from the public executable
owner. Pass the enriched Runtime to support/service provisioning. New workflow
preparation reads `readHerdrRuntime` into its runtime first; prepared run/resume
boot and controller transport use the prepared Runtime's `herdr` rather than a
current setup binding or pane PATH. Preserve explicitly injected offline owners.
A `herdr_not_found` refusal always prints `Herdr not found at <path>`, without
launching, selecting another PATH binary, or hiding it behind generic failure.
The missing-path message is local actionable output, never trace payload.

## Dependencies

- [Public update command](update-command.prompt.md): required generation/runtime for package-local status and finite absent-selector results.

- [Absolute executable](workflow-herdr-executable.prompt.md): required generation/runtime for saved Herdr selection and missing-path refusal.

- [Real Herdr client](workflow-herdr-client.prompt.md): required generation/runtime
  for shared OS identity and actual transport composed by the controller factory.
- [Herdr readiness](workflow-herdr-boot.prompt.md): required generation/runtime default-session startup and setup executable/PATH prerequisite.
- [Herdr diagnostics](herdr-trace.prompt.md): required generation/runtime for opt-in local workflow boundary tracing; no launch authority.

- [Model discovery](workflow-models.prompt.md) and [project discovery](workflow-projects.prompt.md): runtime local adapter factories and explicit public port seams.
- [Versions](versions.prompt.md), [update lock](update-lock.prompt.md) and [launcher](pdd-launch.prompt.md): runtime verified setup/recovery support and service provisioning under the update lease.

- [Story](../../story/cli/PDD-CLI-P1.md) and [cases](../../vectors/cli/pdd-cli-p1.json): verification; expected outcomes, not observed results.
Read the entire [Prompting guide](../../docs/prompting-guide.md) before authoring prompts or Stories. Follow [public alpha boundary](public-boundary.prompt.md) for scope and the shared local command contract.

Required for generation/runtime when routing P1: [controller launch](workflow-controller.prompt.md),
[runner](workflow-runner.prompt.md), [decision](workflow-decide.prompt.md),
[cleanup](workflow-clean.prompt.md), [placement](workflow-placement.prompt.md),
and [public recovery service](workflow-keeper.prompt.md),
[named projects](workflow-projects.prompt.md), [machine CLI models](workflow-models.prompt.md),
[frozen runtime upgrades](workflow-runtime.prompt.md) and
[run-record readers](workflow-run-records.prompt.md).
Required guide context comes through the existing [guidance](guidance.prompt.md)
loader for generation/runtime of skill/native starts. The command catalog and
parser supply accepted route/option syntax for generation and verification.

- [Managed invocation boundary](../accounts/wrapper.prompt.md): navigation-only
  owner for the optional client's scope. Alpha has no required private runtime dependency.
- [Public doctor](doctor.prompt.md): required generation/runtime module binding,
  check/result contract and optional-client SKIP policy.

## Concrete local discovery boundary

Lazily use workflow-models.createLocalWorkflowModelPorts and
workflow-projects.createLocalWorkflowProjectPorts for public executable discovery
and local workflow preparation, with cwd, home, machineId and optional Settings.
Explicit modelPorts/projectPorts remain the accepted adapter boundary and win;
localModelOptions/localProjectOptions may configure public local probe/source
adapters. Local preparation forwards machineId alongside launchSelection, so the runner revalidates the same machine. A named project's selected cwd must also scope native config discovery.
Ordinary foreground sessions without explicit model/effort retain native defaults.
Help/version/skill/completion do not construct or run probes. Do not import private
phone code or widen Alpha packaging. Every explicit --on goes through the public
placement owner; a missing owner is a finite unavailable/remote_unsupported result,
never permission for a named local launch.

At controller launch, map a supplied human resume binding to the controller's
public decision shape {decision,id,rev,expectStage?,expectSeq?}. Runner preparation
keeps its existing {decision,decisionId,expectedRev,expect?} input. Do not pass one
owner's DTO unchanged to a different owner.

Opt-in [Herdr diagnostics](herdr-trace.prompt.md) observe local workflow
preparation/resume and controller start at their actual module boundaries. Pass
the existing full ports object to the trace wrapper and invoke each owner once;
retain raw resolver runtime and canonical prepared runtime independently. Safe
boundary state/code and field-presence diagnostics do not supply missing Herdr,
identity or authority ports, change the launch diagnostic, retry, or convert a
refusal into success. Discovery and remote dispatch do not construct this trace.
