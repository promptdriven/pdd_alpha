# Model and effort from the selected machine's CLI

Own `src/workflow-models.mjs`. Draft for review. Export module functions
`listWorkflowModels({machineId,agent},ports) -> {state,catalog?,code}` and
`resolveWorkflowModel({machineId,agent,selection?},ports) -> {state,selection?,code}`.
Return listed/selected on success or refused on failure. `agent` is codex or
claude. This public module reads the chosen machine's native capabilities and
per-tool Settings defaults, then validates one launch selection. It does not
choose accounts or start an agent. Preservation: new model/effort selection;
full-access, guide-first context, native login/provider and existing exit behavior
remain with their public owners. No global native config write or private import.

## Launch availability (CEO rule 10)

Export `resolveWorkflowLaunchModel({machineId,agent,selection?,frozenSelection?},ports)`
for launch consumers; discovery and Settings writes retain the strict APIs below.
A missing, empty or unreadable native model list must never prevent a run. Use
that tool's Settings `{model,effort}` default when usable; otherwise select native
defaults by omitting both model and effort flags. Do not guess a model or catalog.
An unavailable list takes precedence over start-only overrides. Return a selected
result with `warning: "Model list unavailable; using <default>"`, where `<default>`
is the Settings model or `native defaults`. The CLI prints it once per start;
internal admission/recovery checks do not print. Never include raw probe errors.

Fallback selections retain machine/agent identity, use null `cliVersion` and
`catalogRevision`, and source `settings-fallback` or `native-defaults`; the latter
has null model and effort. Malformed/unreadable Settings supplies no usable default.
Wrong-machine/tool observations and invalid arguments still refuse. A readable
catalog keeps all strict unsupported-choice and invalid-default refusals below.
Freeze the accepted pair or native-default policy at workflow start. A supplied
`frozenSelection` must match the requested machine/tool and valid selection shape;
recovery retains it when the list is unavailable, even if Settings changed. If a
list becomes available, revalidate a saved pair; preserve a saved native-default
policy without inventing a pair. No effects, credentials or configuration writes.

## Valid choices and defaults

Obtain Codex models from that machine's installed CLI `model/list`, including each
model's own supported efforts and hidden flag. Omit hidden entries. Obtain Claude
Code model names and effort capabilities from the installed CLI's supported
interface, with evidence for what that model and current plan accept. Capability
probes must not submit a paid agent turn, sign in or sign out; acceptance tests
requiring personal sign-ins wait for the person. Missing or unverified capabilities
are unavailable, never a guessed model/effort list. No static fallback names,
universal effort enum or source-machine catalog may stand in for target evidence.

The returned catalog is `{machineId,agent,cliVersion,revision,models,defaults}`.
Each model is `{id,label,efforts:[string],defaultEffort:string|null}`. Model ids
and effort strings are native values, not display labels. A model with no exposed
effort control has efforts:[] and defaultEffort:null. Defaults is the per-tool
Settings pair `{model,effort}`; when unset, use the installed CLI's observed default
pair. A missing observed default makes default resolution unavailable. Catalog
revision binds machine, CLI version and current plan/capability observations.
Do not persist or expose plan credentials.

New agent shows the current tool's model list and only that model's valid efforts.
Workflows inherit Settings defaults; `selection={model?,effort?}` is an optional
start-only override. For a model override with effort omitted, retain the Settings
effort if that model supports it; otherwise use that model's observed defaultEffort.
For no model override, use the default model. An explicit effort must be supported
by the resolved model; explicit hidden/unknown model or unsupported effort returns
bad_args. Never silently drop or downgrade an explicit choice. Missing/malformed
catalog or default evidence returns catalog_unavailable. An invalid Settings/native
default also returns catalog_unavailable, with no fallback to a different default.
Empty lists are unavailable.

A selected result carries `{machineId,agent,model,effort,cliVersion,
catalogRevision,source}` with source defaults or override. Recheck capabilities
at native admission; changed unsupported choices stop before launch. Freeze a
workflow's effective pair at start. Defaults changed later apply to future runs;
recovery preserves and revalidates the frozen pair. Cross-tool successors validate
the target tool's defaults separately and record the accepted successor pair.
Account Auto does not imply a model/effort change or cross-tool permission.

<details>
<summary>Required CLI capability and Settings port</summary>

`ports.nativeCatalog.read({machineId,agent})` returns current installed CLI
observations `{machineId,agent,cliVersion,revision,models,nativeDefaults}`; model
records include hidden:boolean before filtering. Claude observations include
validated per-model/per-plan accepted efforts. This is a required public adapter
interface; the concrete installed-CLI transport/schema is supplied at generation,
not invented here. Invalid/missing observations return catalog_unavailable.
`ports.toolDefaults.read({machineId,agent})` returns null (use nativeDefaults) or
`{model,effort}` from Settings. No user/agent/run account scope is accepted.
`ports.nativeCatalog` must run on the selected target; mismatch refuses.
Ports are read-only; exceptions are finite refused results. Alpha supplies local
adapters without importing the optional client. Remote transport supplies target
observations through the same shape. No runtime endpoint is defined here.

</details>

## Local executable composition

Export `createLocalWorkflowModelPorts({machineId,cwd,settings?,executable?,env?,timeoutMs?})`
as the public local adapter factory. Construction has no effects. The returned
nativeCatalog rejects a different machine. For Codex, invoke the installed
`codex --version` and `codex app-server` stdio protocol: initialize with clientInfo
{name:"pdd",version:"1"}, then initialized, config/read with cwd and
includeLayers:false, and paginated model/list with includeHidden:true. Use native
model (the launch identifier), displayName, hidden, supportedReasoningEfforts[].reasoningEffort
and defaultReasoningEffort. The effective config model/model_reasoning_effort
wins when present; otherwise require exactly one isDefault model and its observed
defaultReasoningEffort. Reject contradictory/missing evidence. Bind revision to
the machine, version and projected observations using SHA-256. No thread/turn,
account/login, config mutation or credential-file operation is permitted.

Bound the probe to 10 seconds by default, 16 model pages and 2 MiB of protocol
output; stop only the owned probe process on completion/failure. Suppress raw
stderr/protocol errors. Claude remains unavailable without an explicit verified
nativeCatalog supplied by the consumer; do not manufacture its capabilities.
The returned toolDefaults reads `settings.read({machineId,agent})` when supplied,
otherwise explicitly returns null (Settings unset). It reads no private settings
file and never writes native configuration. Consumers may replace either public
port, including with a target-local client adapter.

## Dependencies

- [Story](../../story/cli/WORKFLOW-MODELS.md) and [cases](../../vectors/cli/workflow-models.json): independent verification expectations.
- nativeCatalog and toolDefaults required caller interfaces above: generation/runtime/testing inputs. The local Codex transport is declared above; Claude acceptance evidence remains required from a supplied verified adapter. Absence blocks strict discovery; launch availability follows rule 10 above without fabricating capabilities.
- [Native flags](native-flags.prompt.md): navigation-only encoding owner for an already validated selection. Its proposed selection parameter is recorded for owner confirmation in lane notes; this module returns no arbitrary argv.
- [Prompting guide](../../docs/prompting-guide.md): authoring method.
