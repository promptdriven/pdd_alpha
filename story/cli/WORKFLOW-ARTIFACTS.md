# Story: artifacts

Draft for review. I want to receive a trustworthy stage handoff and real test outcomes.
The [owning prompt](../../prompts/cli/workflow-artifacts.prompt.md) defines the contract.

## Observable acceptance criteria

- **AC1:** A handoff returns only when its run, stage, issue, input revision and actual file hashes match.
- **AC2:** A different input revision is rejected before it can become stage evidence.
- **AC3:** Unknown handoff fields, duplicate artifact paths and unknown roles are rejected.
- **AC4:** A proposal missing a required Story or cases file is rejected.
- **AC5:** A report may have no files only when the caller requires no artifact roles.
- **AC6:** Digest letter case does not change comparison with the same actual bytes.
- **AC7:** Traversal, absolute paths, metadata artifacts and symlinks are rejected.
- **AC8:** The exact handoff must be a regular file inside this checkout's Git metadata.
- **AC9:** Test arguments preserve spaces and shell characters without shell evaluation.
- **AC10:** A missing or empty test plan never reports passed.
- **AC11:** PASS text cannot override a nonzero process exit.
- **AC12:** A process that cannot start reports a null exit code and cannot pass.

[Expected cases](../../vectors/cli/workflow-artifacts.json) are independent synthetic
expectations. They are not observed program output or a claim that code ran.
