# Story: a workflow stage advances only on checked files and real test exits

Draft for review. A person has not accepted it yet.

## Request and scope

As a person who runs `pdd workflow run`, I want the runner to check each stage
handoff against the real files and to record real test exits, so that a stale,
misplaced or merely claimed result can never advance my workflow. The
[owning prompt](../../prompts/cli/workflow-artifacts.prompt.md) holds the rules.
Preserve its three async module functions, the closed handoff schema, the result
shapes, the refusal conditions and the recorded exit codes.

Out of scope: Git HEAD and currentness, approval, the journal, stage progression
and PR publication, which the
[workflow runner](../../prompts/cli/workflow-runner.prompt.md) owns. Which roles,
files or test plans a stage needs is also caller policy. The checks are local;
they are not a sandbox against hostile concurrent filesystem changes.

## Observable acceptance criteria

- **AC1:** A handoff that meets every condition of the prompt's "Check a handoff
  and its files" section resolves with the parsed JSON unchanged, with no added
  field. This holds for a real `.git` directory and for a linked-worktree `.git`
  pointer file, for digests in either letter case and for an empty file list
  when no role is required.
- **AC2:** A request or handoff that breaks the prompt's "Request, handoff schema
  and identities" rules rejects. Examples: a stale identity, an unknown field, a
  missing required role, a repeated path or an extra `expected` key.
- **AC3:** A handoff that breaks the **Handoff location** rule rejects, even when
  its content is valid. No other location is tried.
- **AC4:** A listed file that breaks the **Artifact checks** or **Actual bytes**
  rules rejects. Each `assertWorkflowArtifacts` call reads the files again, so a
  file changed after an earlier acceptance rejects.
- **AC5:** A test plan or project directory that breaks the **Argv rules**
  rejects before any command starts.
- **AC6:** Valid commands run in the given order through `execFile` with literal
  argv, options `{cwd}` only and no shell. Every command runs, also after a
  failure, and each result has `argv`, `exitCode`, `stdout` and `stderr`.
- **AC7:** Each recorded `exitCode` follows the prompt's outcome table, and
  `passed` is true only when every code is `0`. Output text such as `PASS` never
  makes a command pass.
- **AC8:** No call writes a file or runs Git, a shell or a network operation.
  `readWorkflowHandoff` and `assertWorkflowArtifacts` start no process.

## Cases and evidence

The [expected cases](../../vectors/cli/workflow-artifacts.json) map inputs to
these criteria. They come from the prompt, not from running the module.

Existing tests that exercise the criteria (evidence only; this Story does not
claim that they ran):

- `test/workflow-artifacts.test.mjs`: role and identity tests (AC1, AC2),
  closed schema test (AC2), report-only empty files (AC1, AC2), changed bytes
  and descriptor-read change (AC4), escape and symlink tests (AC4), handoff
  containment and linked-worktree pointer (AC1, AC3), malformed argv (AC5),
  callback, promisified and default `execFile` tests (AC6, AC7).
- `test/workflow-runner.test.mjs`: missing and stale handoff, work stage with
  empty files, wrong implementation with valid files, and a check that rewrites
  the handoff. These show how the caller uses AC1 to AC7.

Passing these finite cases is evidence, not proof over all inputs.

## Open questions

- In production the runner passes no `execFile` port, so Node's default output
  buffer limit applies to test commands. A suite with large output then records
  `exitCode: null` and fails. Should the limit be set explicitly?
- No timeout is set, so a test that never ends keeps the controller waiting.
  Is that accepted?
