# Keep work during run cleanup

Own `src/workflow-clean.mjs`. Draft for review. The module function
`cleanWorkflowRuns({cwd, now, dryRun = false}, ports)` returns
`{removed, retained, warnings}` with run ids and reasons. It owns conservative
cleanup selection and archival, not stage acceptance. Preservation: new cleanup
interface; no lost files, unique commits, journals or unrelated worktrees.

Run daily or with `pdd workflow clean [--dry-run]`. Dry-run performs reads and reports eligibility only: no archive/index writes, claim releases or removals. A PR merged or closed
**more than** 7 days ago only makes a run eligible. Exactly 7 days is retained.
Every condition below must hold; inability to prove any one means retain.

| Required fact | If false or unknown |
|---|---|
| Valid same-run physical assignment and strict readable terminal journal | Retain; report damaged or unfinished |
| No live controller, session/provisional claim, attachment or unresolved effect | Retain |
| No quota WAIT, human wait, question or unfinished stage | Retain |
| Clean index/worktree, including no untracked or ignored files with unique content | Retain |
| Every local commit has a verified durable remote retained copy | Retain; never delete unpushed work |
| Journal, frozen inputs, artifacts and assignment manifest archived outside the worktree metadata | Retain on copy/readback/fsync failure |

Hold the stable commonDir lifecycle guard before checking controller/stage
exclusion. Keep all three through final checks and archival. After a verified
archive/locator and durable common-registry archival intent, release the inner
controller/stage descriptors before worktree removal while retaining the stable
lifecycle guard. This avoids deleting held lock inodes inside worktree metadata.
New drive/attach must take that stable guard and refuse archived/removing runs.
After complete physical removal, record archived ownership and then release it. Recheck dirt, HEAD, remote retention and physical ownership immediately
before removal. Never infer saved work from PR closed/merged, an upstream name,
a merged-base test alone or a local tracking ref. A squash merge need not retain
the local branch's commits. Verify the actual remote branch/reachable history;
no network answer is unknown, so retains. Closed-unmerged PR with unique work
gets a cleanup choice for the person, never automatic deletion. There is no
force path that bypasses unpushed-work preservation.

Archive under `~/.pdd/runs/archive/<runId>/` before normal non-force worktree
removal. Retain original bytes, identities and unknown fields. Verify the archive
and durably append its locator to the runs index; preserve the old locator if
index write fails and retain the worktree. A crash after archive but before
removal reconciles the same archive, never deletes a different assignment.
Keep claims until physical removal is proved; retain the archive and read-only
run history. Do not delete unrelated branches, lock files or version folders.
Alert when disk free is below 2 GB; low disk never loosens a retention rule.

## Dependencies

- [Story](../../story/cli/WORKFLOW-CLEAN.md) and [cases](../../vectors/cli/workflow-clean.json): verification; expected outcomes, not observed results.
- [Worktree assignment](workflow-worktree.prompt.md): required generation/runtime
  for exact physical ownership; this module adds the explicit cleanup path.
- [Claims](workflow-claims.prompt.md): required generation/runtime exclusion.
- [Run records](workflow-run-records.prompt.md): required generation/runtime
  index append after archival. Index failure is advisory to the runner but
  prevents this destructive cleanup path from proceeding.
- Node filesystem and argv-only Git/gh reads plus normal non-force worktree
  removal: runtime via supplied ports; no credential copies or native agents.
