# Public local update status

Own `src/update-command.mjs`. Keep `pdd update` useful in a standalone public
installation without the separately supplied machine release selector. This
behavioral refinement adds public read-only status; it grants no update authority.
Module function `runUpdateCommand({action = null, fleet = false}, ports = {})`
returns `{state, code, message}`; `home` and optional filesystem ports identify
local state. A supplied CLI update module remains its caller's explicit binding.

A plain local show returns shown/code0 even with no installation, a damaged or
unreadable install record, or unavailable runtime metadata. Report current and
previous through the runtime owner's validation, never by treating unverified
paths as a valid installed version. Show target, mode, channel and pin, labeling
unavailable/not-recorded values. Only known valid local mode/channel/pin values
from a readable install record may be displayed. Sanitize control characters and
bound displayed labels; never dump arbitrary records, raw errors or credentials.
The status is a local observation, not release verification or install readiness.

The public package has no production release selector or signed-note fetch
binding. Say that explicitly and that update availability has not been checked;
never claim no updates exist. A check exits1 with that reason and a verified
installer next step. Any requested update/settings change exits1 without an
effect. A fleet request exits1 explaining that it needs the fleet client; local
status cannot stand in for remote status. Do not silently import private modules,
fetch a note, relax signature/target/activation guards or invent a release URL.

Status never creates/repairs directories, acquires the update lease, changes a
record/pointer, starts a process or accesses the network. Errors for a supplied
adapter are handled at the CLI boundary: keep local plain show successful with
available observations and explain unavailable data, while other commands retain
failure and a fixed useful reason rather than a raw exception or false success.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md): authoring.
- [Versions](versions.prompt.md): generation/runtime validation of current and
  previous runtime descriptors; unresolved metadata remains unavailable.
- [Install record](install-record.prompt.md): generation/runtime read-only
  record status and extension-field preservation. No new storage schema.
- Runtime: Node filesystem, path and OS facilities only; no private module,
  hosted service, release key or caller credential is required for local show.
