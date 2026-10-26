# Alpha release package

Own `package.json`'s distribution contract. Draft for review; behavioral refinement
of the existing ESM package. Produce a self-contained public Alpha package with
CLI, complete guide/skill/workflows, local runner and recovery/update primitives.
Fleet client and keeper remain separate. Keep the executable name `pdd`, the MIT
license, supported local commands and the existing engine floor >=22.16.0.
The new install layout is an authorized extension; do not promise the old
single-folder global installation can be overwritten while processes use it.

The package's CLI runs `bin/pdd.mjs`. Include its complete public runtime closure,
docs, skill references, bundled workflows, synthetic example, stable launcher and
bootstrap artifacts. Keep the canonical public module prompts, Stories and
independent expected cases in the repository and source release alongside the
code generated from them. Complete and review each part's specifications before
building that part; generated code does not replace its source contract. Include
the public prompts/cli, story/cli and vectors/cli trees in Alpha, and
keep the private client's specifications in its own package/repository boundary.
Alpha requires no fleet sign-in, private package, hosted
keeper, relay or service adapter to run local commands and P1 recovery. Include
the public generic claim helper, restore contract and minimal controller recovery;
explicit setup installs the public pdd runs-keeper boot/login service. Link reuses
that recovery owner when present; credentials and fleet policy remain client-owned.
No install/postinstall lifecycle script may create services or alter a machine.
Installation is an explicit bootstrap/setup action. Never embed captured chats,
real operational fixtures, credentials, private phone/client code or keeper code.

<details>
<summary><strong>Release identity, artifact boundary and installation</strong></summary>

Use the intended scoped Alpha package `@promptdriven/pdd`; package namespace and
publication rights must be supplied by the release owner. Keep bin mapping
`pdd: bin/pdd.mjs`, ESM, and the public native test command. Build/publish authority
is external to this module; drafting or packing is not permission to publish.
Public Alpha (`promptdriven/pdd_alpha`, the cli part only) publication/merge needs current-revision review and the full public
suite green on the designated VM. Package access and trusted publishing are
release-owner inputs, never credentials distributed to end users.
An authorized agent may merge only through a reviewed change with that VM suite
green; never direct-push main. A test needing a person's sign-in remains pending
until that person supplies it; never sign in/out to manufacture a passing gate.

One machine release identifies Alpha, optional client and Node by verified
immutable artifact identities. Alpha occupies the root of a version folder;
the optional client occupies `client/`. Both are verified before one current flip.
No inplace `npm i -g` of a managed live installation. Never unpublish or reuse a
release identity for new bytes. The installer copies no user state into packages.

The client source repository is private. Its code-visible distribution is the
public npm package @promptdriven/pdd-fleet under the proprietary license: use is
restricted by that license. Use npm integrity and dist-tags, plus the signed
machine manifest for authenticity. No npm account/token on user machines. A
central block can move latest back; never unpublish. Alpha-alone packages and
tests cannot import the client.

Release evidence names the immutable candidate, fixture set, isolated staging
result, real-machine lab result, signing key id and tested Codex/Claude/Herdr/Node
matrix. A failed gate cannot publish. Cover Mac/Linux initially and WSL when
released. Every release also needs the manual ten-minute iPhone check. Keep full scope in
dependency order; lack of a fixed date never waives a gate.

Compatibility evidence must include N-1 reading and preserving state written by N,
plus all older retained unfinished-run/session consumers and the actual fallback.
The lab explicitly includes N-1 and its oldest retained runtime across updates.
Raise the downgrade floor for incompatible formats, and do not activate over a
retained consumer that lacks the necessary contract. Unknown control state gives
Needs you, not permission to act. Package installation and self-test do not rewrite
live journals, worktrees, cache, vault or native tool configuration. Installation
and update preserve client Settings: machine/tool account selection, project base
folder, and per-tool model/effort defaults. They add no agent/run account choice
and do not substitute a package-supplied model list for the machine's native CLI.

</details>

Explicit setup provisions the public recovery service through the stable
`pdd-launch cli runs-keeper` entry, with no release-specific service paths, under
the [launcher's service boundaries](pdd-launch.prompt.md). The recovery owner supplies its
singleton lock; installation must not create a competing Link recovery policy.
Equal service text is not rewritten, and setup never stops an existing Herdr.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): authoring.
- [Versions](versions.prompt.md): required for generation/verification; public
  layout, Runtime and retention boundary.
- [Owned Node](owned-node.prompt.md): required for generation/verification;
  runtime artifact constraints.
- [Public doctor](doctor.prompt.md): required for generation/verification;
  package its Alpha-only diagnostics without a private client import.
- [Stable launcher](pdd-launch.prompt.md): required generation/verification;
  service isolation and boot/login boundary for the installed recovery entry.
- [Story](../../story/cli/PACKAGING.md) and [cases](../../vectors/cli/packaging.json):
  verification. Release signing, provenance, compatibility evidence and the client
  download descriptor are supplied by release CI; this module never fabricates them.
