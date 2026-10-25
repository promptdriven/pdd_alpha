# Named project discovery for local starts

Own `src/workflow-projects.mjs`. Draft for review. Export module functions
`listWorkflowProjects({machineId},ports) -> {projects,warnings}` and
`resolveWorkflowProject({machineId,query},ports) -> {state,project?,candidates?,code}`.
Resolution states are selected, ambiguous, not_found, needs_clone, bad_args and unavailable; failures return code equal to state and selected returns code:null.
This is the public read-only catalog used by `pdd projects` and `pdd session
--project <part of name>`. It lets callers choose a project without typing a
folder. Preservation: new behavior; ordinary session cwd remains unchanged when
no project is requested. Discovery never launches an agent, signs in, clones,
creates a folder or edits a checkout.

## Discovery and useful names

Collect known projects from past Codex/Claude chat folders, Herdr workspaces,
recorded runs, scans of usual local places and GitHub repository inventory. The
caller supplies read-only source adapters in the required interface below.
A missing tool or failed source adds a source warning; healthy sources still
contribute. No source may trigger a login or read native credentials. A history
adapter supplies only project metadata, never conversation text.

Merge local entries with the same real canonical root; use canonical repository
identity to associate remote GitHub entries with an existing clone, retaining
separate local checkouts as separate project identities. Never collapse unrelated
repositories with equal names. Sort by most recent lastUsedAt (null last), then
case-insensitive name, then id. Source order must not change the result. Sources for the same canonical root must agree on its stable id; a conflict drops that root with a warning rather than choosing by source order. Names
are displayed first; repository/machine context disambiguates duplicate names.
Do not present a path text field or use a folder path as the requested identity.
Physical cwd is internal data resolved only from an allowed existing catalog entry.

Each entry is `{id,name,machineId,repository,root,availability,sources,lastUsedAt}`.
`id` is stable for that local checkout or remote repository within the machine's
catalog; the source adapter supplies it, never a display-name index. `repository`
is canonical `{url,ref?}` or null; `root` is an absolute canonical directory or
null. Availability is local or not_cloned. Invalid entries are dropped with a
bounded source warning. Use the directory's project name or repository name,
never invent a name from model output. Empty results are valid.

## Selection by part of a name

Trim query and compare names case-insensitively, exact matches before substring
matches. One candidate returns selected if local; a remote-only match returns
needs_clone, never an implicit write. Multiple candidates return ambiguous with
names and repository/machine labels; none returns not_found. Empty query returns
bad_args. All failure results launch nothing. A path-looking query (absolute,
`~/`, separator or traversal) returns bad_args with "Choose a project by name".
Recheck the selected root's existence and allowed-project identity immediately
before launch; a disappeared or substituted checkout refuses. A successful
resolve does not itself remember last-used; only an actual accepted start does.

The phone's Projects and New agent use this catalog vocabulary and the same
project identities. New agent preselects the last successfully used project if
still available. Projects exposes GitHub clone, Browse folders by taps and New
project through its owning phone actions. An explicit GitHub clone goes to the
Settings project base, default `~/pdd/<repo>`; a name collision asks before an
alternative is chosen and never overwrites. This read-only module returns metadata
for those actions and grants none of their write authority.

<details>
<summary>Required caller interface: read-only project sources</summary>

`ports.sources` contains named async `read({machineId}) -> Project[]` adapters for
codexHistory, claudeHistory, herdr, runs, usualPlaces and github. Adapters return
the entry fields above (sources is supplied by this module), observed roots only,
and null lastUsedAt if unknown. The local composition must include existing cwd
and scan roots configured by Settings; native history/Herdr/GitHub may report
unavailable. No private-client package is required for local scan/run discovery.
The local factory below defines cwd and explicit scan roots; optional native-history readers must be supplied explicitly, never inferred by scanning HOME.
`ports.checkLocal({id,root,machineId}) -> boolean` freshly checks the actual root
and catalog allow rule. An unavailable check refuses selection. Ports may perform
read-only filesystem, Git, installed-tool and already-authorized GitHub inventory
reads. Returned diagnostics contain source ids/codes, no transcripts, tokens or
raw environment. All source exceptions become warnings, not unhandled rejection.

</details>

## Local source composition

Export `createLocalWorkflowProjectPorts({machineId,cwd,home,scanRoots?,settings?,sources?,readRunIndex?})`.
Construction performs no discovery. The usualPlaces adapter includes existing cwd
and immediate child directories of explicitly supplied scanRoots and optional
`settings.readProjectRoots({machineId})` roots. No implicit HOME scan. At most
1,000 children per scan root are inspected. Read-only Git inspection attaches
origin and HEAD when a credential-free HTTPS or git SSH repository identity and
a pinned commit are observed; otherwise repository is null. Canonicalize SCP and
SSH/HTTPS origins to the same credential-free HTTPS identity, removing .git.
Each local checkout id is `local:<canonical root>`; distinct checkouts stay distinct.

The runs source uses the supplied public readRunIndex, or the public run-records
module's reader, and projects existing recorded roots with their observed startedAt.
Keep source failures visible as unavailable warnings. Native history, Herdr and
GitHub remain unavailable unless explicitly supplied through sources; these
adapters supply metadata only. Supplied source records use the same checkout
identity rule. No private module is imported. checkLocal rechecks canonical root,
identity, directory existence and membership in the discovered allow set; it
refuses a symlink substitution. Settings and source exceptions never authorize a
broader scan. A different target machine is unavailable through local adapters.

## Dependencies

- [Story](../../story/cli/WORKFLOW-PROJECTS.md) and [cases](../../vectors/cli/workflow-projects.json): verification of independent expected behavior.
- Caller-supplied project sources and checkLocal declared above: required generation/runtime interface; this is a proposed composition contract, not an existing private import. Source failures remain observable.
- [Phone project owner](../phone/link/projects.prompt.md): navigation-only integration owner for phone catalog, allowed roots and clone/browse/create actions. The R2 source/interface expansion requires owner alignment recorded in lane notes.
- [Prompting guide](../../docs/prompting-guide.md): authoring method.
