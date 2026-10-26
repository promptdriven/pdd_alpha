# Move off an old R-line installation

Own the shipped `launcher/migrate-r-line.sh` interface. This is adoption of the
Mac lead's supplied implementation, retained byte-for-byte; preservation is a
drop-in packaging change. The script owns discovery, backup, service/process
proof, protected paths, migration and undo. The bootstrap owns consent and
continuation. Bash3.2 on macOS and Linux is required; do not invoke it with sh.

`--dry-run` prints planned actions without changing state: exit0 means work,
exit2 means no old install, exit1 means a real migration would refuse.
`--apply --backup-dir DIR` returns0 on completion and1 on refusal, partial work
or failure. DIR retains MANIFEST.tsv, RESTORE.txt and log.txt; failure's last
stderr line identifies the log. `--undo DIR` is an explicit separate operator
operation, never an installer fallback. Partial runs retain recovery evidence.

Old installs include pocket, old services whose programs run there, Session
Links, and wrappers pointing into pocket. Retain personal pdd/claude, standalone
Codex, ~/.codex, ~/.claude and all Herdr sessions/data. Process termination needs
original instance proof and the old CODEX_HOME. Service log paths alone do not
select a service. Preserve exact old PATH-line handling, all unrelated lines,
backup/restore semantics and retained Herdr binary copying from pocket.

Preserve refusals for root/sudo, wrong HOME, protected or aliased paths, insufficient
disk, concurrent runs, unavailable required managers and the supplied refused-user
policy. The installer must not disable any refusal. All script bytes remain the
owner's delivered implementation; no installer-specific rewrite is permitted.

## Dependencies

- [Bootstrap](bootstrap.prompt.md): navigation-only invocation/consent owner.
- [Prompting guide](../../docs/prompting-guide.md): authoring.
- Stock Bash3.2 and platform tools used by the script: runtime; no compile,
  account login or new model/service call supplied by packaging.
