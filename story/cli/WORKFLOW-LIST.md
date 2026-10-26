# Story: list

Draft for review. I want to list local recipe instructions without starting work.
The [owning prompt](../../prompts/cli/workflow-list.prompt.md) defines the contract.

## Observable acceptance criteria

- **AC1:** Manual recipes are sorted and retain project-relative paths.
- **AC2:** A missing recipe directory returns an empty catalog.
- **AC3:** Linked recipe metadata, directories and files are not followed.
- **AC4:** An operational directory error is reported instead of treated as empty.
- **AC5:** JSON formatting preserves the supplied catalog and null default.
- **AC6:** Human output distinguishes inert listing from actual workflow execution.

[Expected cases](../../vectors/cli/workflow-list.json) are independent synthetic
expectations. They are not observed program output or a claim that code ran.
