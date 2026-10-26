# Saved absolute Herdr executable

Own `src/workflow-herdr-executable.mjs`. Export async module functions
`resolveHerdrExecutable(ports={})`, `readHerdrRuntime({home,runtime},ports={})`
and `recordHerdrRuntime({home,runtime,herdr,lease},ports={})`. Preserve immutable
installed release descriptors, existing install fields and frozen run identities.
No service, shell, download, environment mutation or process launch belongs here.

## Selecting the executable

A present `runtime.herdr` takes precedence over `herdrExecutable`, including a
malformed or missing recorded target. Both require a nonempty absolute path with
no control characters, an executable regular file, and no PATH fallback on
failure. Return that exact absolute spelling. Refuse with code `herdr_not_found`
and message `Herdr not found at <path>`; sanitize control characters in the
reported path. A malformed explicit value is a refusal, never an absent value.
Only an unbound legacy/standalone caller may discover Herdr in the invocation's
`env.PATH` (otherwise process.env.PATH); consider absolute directories and return
the first executable's physical absolute path. No executable is ever launched by
its bare name. With no candidate, explain that setup must record Herdr.
Check a selected path on each operation, so deletion cannot silently choose a
replacement. Preserve caller objects and explicit callback references.

## Setup binding and frozen consumers

`recordHerdrRuntime` verifies the absolute executable and saves it as additive
`herdr` setup metadata through the install-record owner's read/write interface
under its valid update lease. Keep every unrelated install field. Return a new
Runtime with `herdr` set only after the durable write succeeds. Do not modify
`versions/<release>/runtime.json`, release receipts or frozen manifests.
`readHerdrRuntime` leaves a Runtime with its own `herdr` unchanged; otherwise read
that setup metadata and return a new Runtime carrying it. Missing setup metadata
preserves legacy absence; damaged metadata/record refuses, never falls back to
PATH. An absent runtime stays absent. Reading does not check executable existence:
discovery/status remain usable, and actual use owns the actionable refusal.
New workflows freeze the enriched Runtime; resume/drive/keeper use the original
journal Runtime, including after a later setup changes the machine binding.

## Dependencies

- [Install record](install-record.prompt.md): required generation/runtime for
  `readInstallRecord` and `writeInstallRecord`, preservation and leased durability.
- Runtime: Node local filesystem executable checks, physical paths and OS home.
- [CLI](pdd-cli.prompt.md), [client](workflow-herdr-client.prompt.md),
  [boot](workflow-herdr-boot.prompt.md) and [stage](workflow-stage-herdr.prompt.md)
  are navigation-only consumers; authority and lifecycle remain with their owners.
