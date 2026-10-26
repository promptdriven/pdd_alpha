# Story: github

Draft for review. I want to publish and recover the exact approved branch without repeating uncertain effects.
The [owning prompt](../../prompts/cli/workflow-github.prompt.md) defines the contract.

## Observable acceptance criteria

- **AC1:** A same-repository issue selector resolves to its canonical identity.
- **AC2:** A PR URL or an issue API response with pull_request is refused as an issue.
- **AC3:** A cross-repository selector cannot bind this run.
- **AC4:** Preparing a clean topic records exact branch/base/SHA and one marker without publishing.
- **AC5:** An uncommitted topic or changed publication input is refused before remote writes.
- **AC6:** Symlinked or multiply linked PR body metadata cannot redirect a write into source.
- **AC7:** A successful publish returns only the verified original repository/head/base/SHA/marker.
- **AC8:** Unconfirmed push never proceeds to PR creation.
- **AC9:** Multiple or changed PR candidates remain uncertain.
- **AC10:** The approved unpublished-only recovery may publish only when both PR searches and the remote head prove absence.
- **AC11:** A present remote head refuses unpublished-only recovery even when its SHA matches.
- **AC12:** Closed-unmerged readback never claims a merge.
- **AC13:** A scan finding adds a redacted warning but does not block otherwise authorized publication.

- **AC14:** Accepted scope artifacts left uncommitted by the agent are committed with their exact approved bytes before the implementation PR; the PR includes both artifacts and the agent commit.
- **AC15:** Unrelated dirty paths, altered artifact hashes or branch/HEAD drift refuse before publication, with unrelated paths and repair guidance; inspection and uncertain recovery do not repeat commits.

[Expected cases](../../vectors/cli/workflow-github.json) are independent synthetic
expectations. They are not observed program output or a claim that code ran.
