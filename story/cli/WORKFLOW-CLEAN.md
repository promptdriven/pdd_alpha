# Story: clean

Draft for review. As a person using PDD, I want to free old run disk space while keeping every unique file, unpushed commit and run record.
The [owning prompt](../../prompts/cli/workflow-clean.prompt.md) defines behavior.
These synthetic observations are independent expected cases, not execution results.

## Observable acceptance criteria

- **AC1:** Safe archive first: removed = true; archiveRetained = true; archiveBeforeRemove = true.
- **AC2:** Age equality: removed = false.
- **AC3:** Unpushed commit: removed = false; reason = "unpushed work".
- **AC4:** Closed unmerged unique: removed = false; personChoice = true.
- **AC5:** Wait even old: removed = false; paneAndWorktreeRetained = true.
- **AC6:** Untracked file: removed = false.
- **AC7:** Ignored file: removed = false.
- **AC8:** Remote unavailable: removed = false.
- **AC9:** Archive full disk: removed = false; originalJournalIntact = true.
- **AC10:** Index write fails: removed = false; archiveRetained = true.
- **AC11:** Race after check: removed = false.
- **AC12:** Dry run: removed = false; fileWrites = 0; worktreeRemoves = 0.
- **AC13:** Low disk: alert = true; removed = false.

[Expected cases](../../vectors/cli/workflow-clean.json). Case keys express observations;
they do not invent a product wire format. No implementation or live test ran.


## Review edge cases

- **AC14:** Stable lock during remove: stableLifecycleHeldThroughRemoval = true; innerLockDescriptorsReleasedBeforeRemoval = true; heldLockInodeDeleted = false.
