# Story: each issue run works in its own worktree and keeps that identity

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who runs several issue workflows in one repository, I want each run to get its own Git worktree and branch, so that one issue's stages cannot change another issue's files or my own checkout. When a run stops or a reply is lost, I want a later resume to find the same worktree or to stop for inspection, so that PDD never creates a second worktree for the same issue.

The [owning prompt](../../prompts/cli/workflow-worktree.prompt.md) holds the rules. This Story makes them observable. It preserves the module functions `allocateIssueWorktree` and `lookupIssueWorktree`, the result envelope and its three states, the run record, the saved locations, the branch and path names, the exclusive issue claim, the single `git worktree add` and the read-only verification.

Out of scope: the run journal and stages (owned by the [workflow runner](../../prompts/cli/workflow-runner.prompt.md)), resolving the GitHub issue, fetching the base ref, and any cleanup or release of worktrees and claims.

## Observable acceptance criteria

- **AC1:** A valid new allocation returns `ready` with an assignment equal to the saved run record. Its worktree path, Git directory and branch follow the names in the prompt's saved-records rule, including the `safeName` form of the workflow name. `baseSha` is the commit of the supplied base ref, and the new worktree holds that commit's files. Exactly one `git worktree add` runs, with the saved branch, path and `baseSha`.
- **AC2:** After allocation, the person's checkout has the same file bytes, the same Git status (dirty and untracked files included) and the same current branch. A commit in one issue worktree does not change another issue worktree or the person's checkout.
- **AC3:** For one issue in one common Git directory, at most one run gets a claim and a worktree. Another run for that issue returns `conflict`, also with another workflow name, from a linked checkout, or when it races in another process. Allocations for different issues, also in parallel processes, all return `ready`, and each keeps its own run record and claim.
- **AC4:** A repeat allocation of a saved run with the same request returns the same assignment. It runs only the read-only Git subcommands named in the prompt, changes no saved file and does not add, also after the base ref moved to a newer commit. A repeat with a different issue, workflow or base returns `conflict` and does not add.
- **AC5:** When the add runs, the run record and the issue claim already exist as one file with link count 2, and the add arguments equal the saved branch, path and `baseSha`.
- **AC6:** After an add with a lost reply, the result is `ready` when the real worktree matches. After an add that failed with no effect, or a process that stopped before the add, the result is `recovery_required`. Later lookups and allocations of that run return the same state, leave the run record bytes unchanged and never add again. Another run for that issue still returns `conflict`.
- **AC7:** Lookup creates and changes nothing. For a missing run it returns `recovery_required` and does not create the `pdd` folder. It finds the same assignment from the original checkout or from a linked checkout, also after later commits in the issue worktree. A changed branch, a redirected `.git` file, a changed `origin`, a partial run record, a missing claim or an invalid run ID returns `recovery_required`, and the damaged state stays as found.
- **AC8:** An input outside the prompt's valid-request domains, or a `repository` that differs from the `origin` repository (ignoring case), returns `conflict` with no claim. A repository that differs only in case is accepted and saved in the supplied spelling. An absent base ref, a revision expression as the base, an `origin` that is not an ordinary GitHub URL, or a metadata folder that is a symbolic link returns `recovery_required` with no claim and nothing written through the link.
- **AC9:** An existing branch with the generated name returns `conflict`, leaves that branch unchanged and saves no run record. A folder that someone else puts at the intended worktree path returns `recovery_required`. Its files stay, it is never adopted, and no later call adds again.
- **AC10:** While Git's `initializing` lock is on the new worktree, lookup and repeat allocation return `recovery_required` and do not unlock it. After the original add completes, the result is `ready`. After an interrupted add, it stays `recovery_required` and the lock stays. A protective lock with or without a reason does not stop `ready`.
- **AC11:** Each command-port call receives `git`, an argv array and an options object that holds only `cwd`. A rejection with `code` 0 is never success. Neither function rejects, also for a missing input object.

## Cases and evidence

The independent [expected cases](../../vectors/cli/workflow-worktree.json) map inputs and starting states to these criteria. They were written from the prompt, not from running the module.

Existing tests are evidence for the criteria. This Story does not claim that they ran.

- [`test/workflow-worktree.test.mjs`](../../test/workflow-worktree.test.mjs) uses disposable real repositories. Its tests cover AC1 and AC2 (two concurrent issues, also in separate processes), AC3 (exclusive claim across workflow names, linked checkouts and processes), AC4 (same-run resume, retargeting, advanced base), AC5 (same inode before add), AC6 (lost reply, rejected add with `code` 0, process death before and after add), AC7 (missing lookup, changed branch, `.git` pointer and origin, partial record, missing claim), AC8 (foreign repository, absent base, `main~0`, symbolic-link metadata folder), AC9 (colliding branch, unowned folder), AC10 (initializing lock with completed and interrupted checkout, protective locks) and the port options in AC11.
- [`test/workflow-runner.test.mjs`](../../test/workflow-runner.test.mjs): the default allocator test runs this module through the runner, including the runner's direct read of the issue claim when a second run for the issue conflicts (AC3).

No existing test directly covers the length and type boundaries in AC8, a case-only repository difference, a non-GitHub `origin`, a `safeName` other than plain `feature`, lookup from a linked checkout, an invalid lookup run ID, or a missing input object. Passing these finite cases is evidence, not proof over all repositories, Git versions and process interleavings.

## Open questions

- The [workflow guidance](../../docs/workflows.md) says that shared-index updates are serialized. The prompt instead keeps one immutable file per run and serializes only the contested issue through an atomic claim link. Should that guidance say so?
- A run that loses the claim race keeps its run record, and every later call for that run ID returns `recovery_required`. A failed allocation can also leave empty metadata folders. Both follow the no-cleanup rule. Is that the accepted outcome?
- The source accepts an `ssh://github.com/` origin without a user name, and the prompt keeps that. Is a missing SSH user name intended?
