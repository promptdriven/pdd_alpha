# Move off an old R-line installation

Own the shipped `launcher/migrate-r-line.sh` interface. This is adoption of the
Mac lead's supplied implementation. Preserve its behavior except the named
protected-native-profile repair: shell-profile migration must refuse protected
Codex/Claude paths before any backup or write. The script owns discovery, backup, service/process
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
policy. Shell profiles inside `~/.codex` or `~/.claude`, including normalized
paths and directory aliases resolving inside them, must remain byte-, mode- and
mtime-identical. Discovery and the write guard must use the original pathname
with physical directory resolution: a symlink followed by `..` must not be
lexically collapsed into a different target before checking it. Report refusal without creating adjacent or migration profile backups.
Apply the same check to dry-run planning and direct profile editing; an
unresolvable profile parent refuses. Ordinary profiles retain exact old-line
replacement and backup behavior. The installer must not disable any refusal or
rewrite the owner script.

## Dependencies

- [Bootstrap](bootstrap.prompt.md): navigation-only invocation/consent owner.
- [Prompting guide](../../docs/prompting-guide.md): authoring.
- Stock Bash3.2 and platform tools used by the script: runtime; no compile,
  account login or new model/service call supplied by packaging.
