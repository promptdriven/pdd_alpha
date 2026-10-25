# Story: diagnostics work without the client

Draft for review. As a person using Alpha alone or with the optional client, I
want local health checks and a safe support report, and I want a staged release
to verify its public runtime without signing in or changing my machine. The
[contract](../../prompts/cli/doctor.prompt.md) owns the public doctor entry.

- **AC1:** The public runDoctorCommand binding supports exactly the declared modes;
  malformed syntax exits 2 before reads, adapter loading or effects.
- **AC2:** Alpha-only checks run without a private import. Client-owned checks are
  SKIP with a reason when the client is absent. A broken required installed-client
  self-check is FAIL rather than an absent-client skip.
- **AC3:** Preserve check rows, text PASS/FAIL/SKIP lines, one next step per failure,
  JSON `{ok,checks}` and 0/1 health exit semantics. Independent checks survive a
  failed check; exceptions never escape the public binding.
- **AC4:** Check-only reads the selected temporary/runtime paths locally. It uses
  no network, writes, sign-in, refresh, native-model call or service mutation.
  Missing required candidate files fail. The updater owns token comparison.
- **AC5:** Report goes only to stdout, contains at most 200 redacted log lines and
  the declared support facts, and excludes every named secret/private payload.
- **AC6:** Cleanup inventories exact owned legacy items and requires fresh per-item
  keep/unload/remove choices. Noninteractive use and unanswered choices perform no
  cleanup effect; keep is always available.
- **AC7:** Cleanup rechecks identity, ownership and live references. It never selects
  by process name or affects Herdr, agents, controllers, native sign-ins or unrelated
  configuration. Failed or uncertain targets are retained and reported.
- **AC8:** The four read modes never mutate state, and cleanup is never part of
  bootstrap continuation or updater self-check. Only explicit cleanup choices have
  cleanup authority.
- **AC9:** Client diagnostics describe machine/tool account and launch defaults
  read-only, adding no per-agent/run account setting, project selection or bundled
  model/effort list. Check-only never queries native capability discovery.

[Expected cases](../../vectors/cli/doctor.json) use synthetic check rows and local
inventory. No implementation, credential inspection or actual cleanup ran.
