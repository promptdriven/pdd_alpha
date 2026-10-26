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
