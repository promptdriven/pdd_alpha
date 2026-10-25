# Story: recover an interrupted install

Draft for review. As a person whose machine restarts during an update, I want
PDD to recover the last durable transaction and count startup failures only once.
The [contract](../../prompts/cli/install-record.prompt.md) owns install state.

- **AC1:** Only a valid install lease and matching expectedRev can replace a record;
  a write advances rev, preserves unknown fields and uses durable atomic replacement.
- **AC2:** Interrupted/full-disk writes preserve the last complete record and stop
  effects that depended on the missing transition. Corrupt state is preserved.
- **AC3:** Intent, from/to runtimes and activation barrier survive crashes. Unknown
  phases give recovery_required rather than a fabricated fresh/ready install.
- **AC4:** Exit-before-ready or the persisted ten-minute deadline without prior
  ready counts once. Link clears its unresolved entry through the record owner
  after matching local success. Late ready never resets an accepted failure;
  uncertain process identity never permits killing a successor.
- **AC5:** The rejected release identity survives reboot and manifest edits. Redacted
  pending reports keep stable ids until delivery is confirmed.

[Cases](../../vectors/cli/install-record.json) describe expected state. The vectors
do not mutate any real install record or exercise actual durability.
