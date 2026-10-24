# Story: a workflow run publishes one exact PR and never resends one

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who runs `pdd workflow run` on an issue, I want the run bound to
the real issue in my current GitHub repository, and each PR stage published as
one exact pull request through my own `git` and `gh` login. If a push or PR
creation is interrupted, I want the run to find that same PR again rather than
create a second one. If my first push failed before it reached GitHub, for
example at a login prompt, and I approve the same PR stage again, I want that
same intent published once, but only when GitHub shows neither the PR nor the
branch. So I can trust each PR link that the run reports, and I never get a
duplicate PR or a merge I did not make.

The [owning prompt](../../prompts/cli/workflow-github.prompt.md) holds the
rules. This Story preserves its four module functions, input fields, result
shapes, refusal codes, write commands and effects. Out of scope: the runner's
journal, locks, stage order, merge waits, exit codes and the approval that
selects recovery (owned by the
[workflow runner](../../prompts/cli/workflow-runner.prompt.md)); fetching;
merging; and any private service.

## Observable acceptance criteria

- **AC1:** Each accepted issue selector form resolves to the actual issue in
  the `origin` repository, as the prompt's "Resolve an issue" rules state:
  GitHub's repository name, its default branch, and the issue's number, URL,
  title and body. A `null` body becomes `''`.
- **AC2:** A PR URL, a malformed selector, another repository, or a number that
  GitHub reports as a PR rejects with the named `workflow_github_` code. A
  malformed selector runs no command. An origin URL with credentials refuses,
  and no error contains them.
- **AC3:** A successful prepare returns exactly the nine intent fields from the
  actual checkout. The body file gets exactly one marker line, and a repeated
  prepare leaves the same bytes. Prepare never pushes or writes to GitHub.
- **AC4:** Prepare refuses each failed checkout check with its named code, and
  then leaves the body file unwritten. An aliased body path (symbolic link,
  linked ancestor or hard link) never changes the file it points to.
- **AC5:** A first publication runs exactly one `git push` of the saved commit,
  with no force option, then exactly one `gh pr create` with the explicit
  arguments. It reports only the PR that a read-back finds.
- **AC6:** Without the recovery flag, when an exact PR already exists, publish
  reports its state and runs no push, no create and no body read or write.
- **AC7:** Without the recovery flag, when local source no longer matches the
  intent, or the push URL is not one URL for the same repository, publish
  returns `failed` with `pr` `null`, and no write runs.
- **AC8:** After a write starts, any failure, rejection or missing read-back
  returns `recovery_required` with `pr` `null`. A failed push prevents create.
  A lookup that cannot prove absence also returns `recovery_required`, with no
  write.
- **AC9:** Reconcile runs only reads. It returns `recovery_required` with `pr`
  `null` for a missing, duplicate, changed, forked or otherwise different PR,
  a full lookup page, or an invalid intent. It never returns `failed`.
- **AC10:** The outcome is `{ state, pr, message }`. `OPEN`, `MERGED` and
  `CLOSED` map as the prompt's state table says: merged needs GitHub's merge
  commit, and closed is not merged.
- **AC11:** A change to the caller's input object while a call waits does not
  change what the call checks or returns.
- **AC12:** With `unpublishedOnly: true`, publish writes only after both PR
  lookups find no PR, the local source matches, and
  `git ls-remote --exit-code --refs origin refs/heads/<headBranch>` exits with
  code 2 and prints nothing. Then it runs the AC5 push and create once with
  the unchanged saved intent, and reports only the PR that a read-back finds.
  Reconcile never runs `ls-remote`.
- **AC13:** In that mode, each refusal in the prompt's "Recovery mode" rule
  returns `recovery_required` with `pr` `null` and no write. This includes any
  existing PR (even an exact one), a listed remote head (even at the saved
  SHA), an unreadable PR lookup or remote read, a local mismatch, and a body or
  source change while the remote read waits. A lost push never leads to
  create.
- **AC14:** A non-boolean `unpublishedOnly`, including `null`, returns
  `failed` and runs no command. A missing or `false` flag gives the AC5 to AC8
  behavior.

## Cases and evidence

The independent [expected cases](../../vectors/cli/workflow-github.json) map
inputs and starting states to these criteria. Their values come from the
prompt, not from running the module.

Existing tests that exercise the criteria (named as evidence only; this Story
does not claim they ran):

- `test/workflow-github.test.mjs`: AC1 and AC2 (selector resolution, PR and
  foreign refusals, origin and JSON errors); AC3 and AC4 (prepare, dirty and
  conflicting-marker refusals, untracked body, real disposable Git checks,
  alias refusals); AC5 to AC8 (first publication, existing PR, changed source,
  push URL, interrupted push or create, rejected push with code 0); AC9 and
  AC10 (read-only recovery refusals, state mapping, marker and head lookups,
  full page); AC11 (captured intent); AC12 to AC14 (unpublished-only
  publication after both absences, present or unconfirmed remote head,
  existing or unreadable PR lookups, checks before effects and after the
  remote read, uncertain push or create, non-boolean mode, real disposable Git
  remote).
- `test/workflow-runner.test.mjs`: AC5 and AC8 through the caller (intent saved
  before push, a lost create reply reconciled without a second push or create,
  a replacement PR refused at the merge wait); AC12 and AC13 through the caller
  (recovery only on a new approve after a push failed at a login prompt,
  refused present remote head and unreadable reads, a lost reply during
  recovery reconciled without another write).

Passing these finite cases is evidence, not proof over all inputs.

## Open questions

- Prepare and the intent accept only 40-character SHA-1 object names. A
  repository that uses SHA-256 object names is refused. Is that the accepted
  scope?
