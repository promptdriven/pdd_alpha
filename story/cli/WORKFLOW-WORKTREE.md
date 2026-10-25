# Story: worktree

Draft for review. I want to give one issue its own worktree while preserving my checkout.
The [owning prompt](../../prompts/cli/workflow-worktree.prompt.md) defines the contract.

## Observable acceptance criteria

- **AC1:** Allocating a new issue worktree leaves source files and status unchanged.
- **AC2:** A failed fetch never uses a stale base for a new worktree.
- **AC3:** The common-repository issue claim prevents two workflows from allocating the same issue.
- **AC4:** Concurrent different issues retain both durable run entries.
- **AC5:** A lost worktree-add reply can reconcile only the original saved physical assignment.
- **AC6:** Partial metadata or an absent original worktree preserves uncertainty without another allocation.
- **AC7:** Read-only lookup accepts later commits and dirty files when identity and base ancestry remain valid.
- **AC8:** An initializing Git worktree is not ready even when branch/path/HEAD match.
- **AC9:** An ordinary protective lock does not invalidate an otherwise complete worktree.
- **AC10:** Lookup preserves a valid historical metadata-local layout.
- **AC11:** A redirected allocation parent or mismatched Git registration is refused.
- **AC12:** A rejected subprocess is failure even if its attached numeric code is zero.

[Expected cases](../../vectors/cli/workflow-worktree.json) are independent synthetic
expectations. They are not observed program output or a claim that code ran.

- **AC13:** A successful fetch whose fetched commit differs from the selected remote-tracking base cannot allocate from that stale local base. Preserve uncertainty and create no worktree.
