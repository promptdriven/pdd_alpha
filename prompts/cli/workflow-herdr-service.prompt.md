# Persistent default Herdr service

Own `src/workflow-herdr-service.mjs`. Public setup installs the default Herdr
server as a user service so a user-manager restart does not leave workflow
recovery without its transport. Preserve existing servers, native sessions,
controller locks/proofs, frozen executable selection and unrelated user services.
Installation and enablement are explicit setup effects; imports and diagnostics
never install, start, stop or restart anything.

## Installation and identity

Module function `herdrServiceFiles({home,herdr,platform})` returns the one owned
service definition `{path,text}` for supported Linux/macOS, with an absolute
Herdr executable and explicit HOME/working directory. Encode paths as literal
systemd arguments or XML strings, including spaces, quotes, dollar and percent
characters; reject control characters. No PATH-selected executable in a service.
Linux owns `~/.config/systemd/user/pdd-herdr-default.service`, enabled under
`default.target`, automatic restart after failure and KillMode=process so a manager restart of
Herdr does not kill its native children. macOS owns
`~/Library/LaunchAgents/ai.promptdriven.pdd-herdr-default.plist`, RunAtLoad and
KeepAlive and AbandonProcessGroup with the absolute executable plus `server` as separate arguments.
Neither service invokes a shell, PDD controller, agent or optional Fleet client.

Async module function `provisionHerdrService({home,runtime,lease},ports={})`
requires the actual update lease and resolvable runtime.herdr before effects.
Create only owned canonical directories and a private regular service file;
never follow an aliased parent/final link, overwrite different existing bytes,
change runtime trees or replace another service. Existing definitions must also
be private: no group/other permissions, owner read/write only (0600 or stricter),
and no executable or special mode bits. Matching but readable definitions refuse
setup reuse, startup and doctor pass without chmod or overwrite. An equal private definition is reusable,
but does not prove enablement. A conflict requires explicit inspection/repair.
Linux reloads definitions, enables the unit, requests `loginctl enable-linger`
for the current numeric user without sudo or interactive privilege prompting, and verifies enabled plus linger=yes.
A denied or unavailable linger request fails with a repair step; no reboot-ready
claim. macOS enables the exact gui/uid label and bootstraps only if unloaded,
then verifies that label is loaded and not disabled. Never bootout/restart a
loaded service. No arbitrary manager output is printed. Manager commands use
bounded argv execution, shell:false, with the invocation's user environment.
Return `{code:null}` only after definition and enablement readback; otherwise
`{code,message}` with a finite setup repair instruction. Readiness is separate.

## Startup and observation

Async `startInstalledHerdr(ports,herdr,timeoutMs)` is the bounded startup seam:
validate the fixed local definition against the selected absolute executable.
Absent definition returns `{installed:false}` without effects, permitting the
boot owner's existing unmanaged startup. An unsafe or mismatched definition
refuses without fallback. Matching Linux definition requests `systemctl --user
start pdd-herdr-default.service` once; matching macOS definition prints the label,
then bootstraps if absent or kickstarts without -k if loaded. No stop/restart.
Use only the supplied remaining monotonic budget for these commands, rechecking
between awaits; one call never retries a startup. Return `{installed:true,...}`
with command outcome, never transport/process readiness. The boot owner must
still obtain a fresh default-session read within its original deadline.

Async `checkHerdrService(ports={})` returns one doctor row with id
`herdr-service`, state pass/fail/skip, detail and next. It reads the saved setup
binding (or explicit runtime/herdrExecutable), validates exact service bytes,
and checks Linux enabled/active/linger or macOS loaded/running/not-disabled.
Missing, mismatched, disabled, stopped or unverifiable service is fail with
`Run pdd setup to install and enable the Herdr user service.` Unsupported OS is
skip. Checks never start or repair. Service health is not controller or stage
proof; a manager acknowledgement alone is insufficient for workflow readiness.

## Dependencies

- [Absolute executable](workflow-herdr-executable.prompt.md): generation/runtime,
  recorded executable selection and exact missing-path refusal.
- [Private directories](pdd-directory.prompt.md): generation/runtime for canonical
  owned directory creation without modifying existing unrelated modes.
- [Update lock](update-lock.prompt.md): generation/runtime for validUpdateLease.
- [Herdr diagnostics](herdr-trace.prompt.md): generation/runtime for actual startup request tracing, never readiness or authority.
- [Install record](install-record.prompt.md): runtime read-only saved Herdr binding.
- Node filesystem, child_process argv calls, OS user/home, monotonic clock;
  Linux systemctl/loginctl or macOS launchctl. Optional ports: home, platform,
  env, runtime, herdrExecutable, promise execFile. No live service test is required.
