# Stock-machine release bootstrap

Own the release `install.sh` entry. Draft for review; new work, behavioral
refinement. Given an explicitly invoked verified release installer, install PDD
Node first and enter setup on a stock Mac or Linux machine with no Node/npx.
The GitHub release is the bootstrap source; installation never comes from the
phone app domain. Keep npx setup as an alternative when Node is already available.

Public invocation: `sh install.sh [setup arguments]`. It runs the selected release's
`bin/pdd.mjs setup` under its owned absolute Node, preserving cwd and arguments as
argv elements, never shell-evaluated text. Setup owns tools, accounts, fleet and
consents. Bootstrap does not sign in, read credentials or invent setup answers.
Internal download/extraction tools may vary within this contract.
Optional client setup delegates account configuration to Settings once per
machine/tool; bootstrap asks no agent/run account questions. Named-project
discovery and native model/effort capabilities belong to their client/CLI owners,
not the install preflight.

Create every bootstrap-owned PDD directory with mode 0700 even under umask 002.
Before delegating an existing managed install, repair the owned `~/.pdd` root
and existing direct mutable children `logs`, `runs`, `fleet`, `accounts`,
`claims`, `install` and `link` to 0700; refuse a symlink or ownership mismatch.
Do not recurse or modify existing immutable runtime trees or receipts. Before
creating staging children, validate owned parents without following links; new
parents are 0700 and existing other parents retain their modes. Extracted directory
modes are also 0700 before executing the verified runtime; preserve artifact file
bytes and file executable modes. Failed privacy repair stops installation and
does not authorize replacing an existing runtime or bypassing recovery. During
stock-shell directory repair, retain the entered parent directory as authority
for child creation and mode repair, including recursive normalization of fresh
extraction trees. Enter each verified owned real directory before its mode write;
never send previously enumerated pathnames to a later chmod. Refuse a changed
canonical parent or child and any substituted link; never chmod an outside target.
Cover hidden and option-like directory names while leaving regular files untouched.
Retain the user invocation cwd for the eventual setup command.

<details>
<summary><strong>Trusted first execution and interrupted setup</strong></summary>

Before executing a downloaded Node or Alpha artifact, verify it against the
trusted release descriptor and pinned verification material carried by the
verified bootstrap. A hash fetched from the same untrusted body is insufficient.
The exact asset URL, signature mechanism and artifact table are release inputs;
if unavailable, print an actionable verification error and execute nothing.
Do not print a fabricated production curl command or trust root.

`launcher/build-bootstrap.mjs:buildBootstrap({descriptor,destination,custody})`
accepts optional staging release custody from the trusted release builder:
`{descriptorBytes, signature, publicTrust}`. The bytes must parse to the same
descriptor used in the artifact table; verify its Ed25519 signature with the
builder-supplied public-only staging trust and matching key ID before generating
an installer. This build input is not a runtime trust-discovery mechanism.
Preserve those exact bytes, never a JSON reserialization, in the installer.
Unsigned legacy/public bootstrap inputs remain supported without custody files.

For signed custody, create `trust/descriptor.json`, `trust/descriptor.sig` and
`trust/release-root.json` only inside this bootstrap's fresh Alpha extraction
tree, before its directory digest and atomic immutable-version publication.
Descriptor signature framing is the canonical base64url token plus one LF.
Public root metadata uses U4b's `schema: "pdd/staging-release-root/v1"` and
`purpose: "u4-user-release-root"`, with staging environment, key ID, Ed25519 algorithm,
SPKI public PEM and its DER SHA256. It carries no private material and is not
authority by presence: the Keeper-owned consumer must independently pin the
U4b root in trusted code/provider before comparing this file and verifying the
descriptor. No caller/receipt/tenant/current selector becomes trust.

Retain entered directory authority for these writes. Refuse a preexisting or
symlinked `trust` path, never overwrite source-archive files, and create the
directory0700/files0600. Publication's existing tree digest includes these files;
keep existing immutable runtimes, receipts and lifetime/GC rules unchanged.
Existing-install delegation does not add or replace custody. A private consumer
uses its actual retained physical versionRoot, not current or cwd. Bootstrap adds
no runtime reader, provider or credential-helper inference.

For the Wednesday staging release, a signed descriptor may include
`client: {path:"client", algorithm:"pdd-directory-sha256-v1", digest}` where digest
is 64 lowercase hex from the owned Node directoryDigest function over the
normalized staged client tree. Before any install-state mutation, verify the
retained exact descriptor bytes and canonical signature against the staging root
carried by the verified installer, require equality with the artifact-table
descriptor, and verify the client digest. Malformed custody or changed client
bytes refuse with verification_error. This installer root input is not a new
runtime authority provider. Unsigned legacy descriptors without client remain valid.
After ready publication, recheck the retained physical client tree and record
`installedClients[releaseId] = {path, algorithm, digest}` under the existing
install lease/revision before continuation; path is versionRoot/client. Refuse
a conflicting existing entry without overwriting it. Equal entries are retained.
This additive install provenance does not set Runtime.clientDigest, infer a
credential helper, authenticate a machine to Keeper, or change custody paths.
Keeper machine authority remains fleet membership; public-user authenticated
binary binding is a later design issue.

Preflight OS/architecture, HTTPS/download tools, verification tools, owned-path
writability and disk requirements. Missing prerequisites yield one next step,
without privileged installation, automatic sudo or shell-profile edits. The
download must leave at least 1 GB free after staging. Detect tool availability
for setup to explain Codex-only, Claude-only or both; state that chosen native
tools must be installed and Claude needs a plan that permits setup-token. Offer
the documented installers through setup and preserve its consents. WSL follows
its separately gated Linux path after systemd/linger and restart checks pass.

Stage downloads in unique temporary folders outside update.lock; use the lock
for short setup/activation mutations and durable checkpoints. Existing managed
install: before handing off to its launcher, state plainly that this installer
did not install a new release, the existing runtime is retained, and setup checks
that installation. Setup success must not imply the requested release was installed.
Recover interrupted install state through that launcher; a newer fetched bootstrap
is not permission to replace current. Fresh install: verify and stage a complete
runtime, then use the same activation primitive as updates. Keep the executing
bootstrap's complete code/native-helper closure in separate transaction-owned
storage through publication and support provisioning: moving a candidate into
its immutable location must not invalidate later kernel-lock or privacy-helper
calls. Delegate setup only after the selected runtime, durable ready record,
launcher support and recovery-service provisioning succeed; genuine failures
remain failures. Before current exists, cancellation or failure
may remove only this bootstrap's incomplete temporary files. After a flip,
recovery uses the recorded transaction; never erase it and start again blindly.
Every checkpoint prints `pdd setup` as the resume command. Rerunning plain
`pdd setup` recovers the same transaction from the install record; no `--resume`
flag or new setup transaction is invented.
When recovery support is absent, the matching verified installer may resume only
the exact saved first-install target and transaction. Before saving unfinished
intent, establish process-instance ownership on Linux and Mac. A matching live
owner (including a stopped process) excludes retry; only proven owner death or
replacement permits takeover. Unknown, missing or unreadable ownership evidence
must leave the saved intent untouched. Mac uses stock process start-time and
kernel boot identity facilities; coarse identity collisions conservatively count
as live. Keep Linux process proof and exclusion behavior unchanged. After a
recorded flip, repair support without blindly repeating activation.
Continuation preserves existing machine/tool account settings, project base
folder and per-tool model/effort defaults; rerunning setup does not reset them.

Setup reruns preserve agents, controllers, Herdr and native sign-ins. Equal owned
files are not rewritten. A Link restart requires an actual service/runtime change
and the activation barrier. No browser or phone is needed for bootstrap itself.
Closing the invoking SSH session cannot stop an already accepted detached update.
Before detach acceptance, report failure honestly; do not leave an untracked job.
Before either existing-install delegation or fresh runtime staging, detect possible
old R-line installs read-only: pocket, old gateway/team-access/session-links
service/app paths, and local pdd/pdw/pdd-v1 wrappers referring into pocket. An
unrelated personal pdd is not an old install. Invoke the release-embedded,
unchanged Mac-owned `launcher/migrate-r-line.sh` with stock `/bin/bash --dry-run`;
the script owns exact identification and all migration effects. Exit2 continues
without a prompt; exit1 or unexpected exit stops. Exit0 displays the plan and
asks exactly "Move off the old PDD build? [Y]". Empty, y or yes consents;
EOF/other answers stop with no apply. On consent call `--apply --backup-dir`
with a UTC-named path under ~/.pdd/migrate; only exit0 permits continuation.
An apply failure stops and prints that backup's log.txt path. Preserve script
refusals, protected native sign-ins/Herdr and user tools; never override its
refused-user setting, invoke undo automatically or bypass a failed migration.
The verified installer embeds the script so existing installs need no download
or old-runtime script selection. Temporary embedded-script files are private
and removed after the call; migration backups remain for explicit recovery.

After the managed runtime and stable launcher are available, retire only the
identified legacy global npm Alpha through the [npm cleanup owner](npm-cleanup.prompt.md)
before entering setup. Embed that same reviewed cleanup module in the generated
installer for existing installs; they use their retained support Node and never
a system/PATH Node. Preserve Python pdd-cli and unrelated npm packages.
Keep setup short: old LaunchAgent/unit and other legacy wrapper cleanup belongs
to pdd doctor --cleanup, not a required inventory wizard. Setup must prove the PDD shim wins
in a fresh zsh/bash/fish shell and a Herdr pane, or show the actual winner and one
repair step. For optional client setup, preserve the
[wrapper boundary](../accounts/wrapper.prompt.md): setup changes no stock sign-in
or managed-session scope; explicitly consented Herdr hook/config additions remain
setup-owned.

</details>

## Dependencies

- [R-line migration](migrate-r-line.prompt.md): generation/runtime/testing;
  package and invoke the unchanged Mac-owned script with its Bash contract.

- [Prompting guide](../../docs/prompting-guide.md): authoring.
- [Packaging](packaging.prompt.md), [owned Node](owned-node.prompt.md),
  [install lock](update-lock.prompt.md), [install record](install-record.prompt.md)
  and [detached updater](detached-updater.prompt.md): required for generation and
  verification; bootstrap must meet their contracts before the Node modules run.
- [Legacy npm cleanup](npm-cleanup.prompt.md): generation/runtime; only the
  identified global npm Alpha is retired after managed support is available.
- [Public doctor](doctor.prompt.md): required for generation/verification;
  diagnostic/cleanup modes are separate from checkpoint continuation.
- [Wrapper boundary](../accounts/wrapper.prompt.md): required generation/verification
  context only for optional client setup; no private runtime import by Alpha.
- [Story](../../story/cli/BOOTSTRAP.md) and [cases](../../vectors/cli/bootstrap.json):
  verification.
- Runtime: stock shell plus explicit HTTPS, archive and signature-verification
  facilities. Full fleet setup context belongs to its caller and is required
  before that later setup step; no account policy is owned here.
