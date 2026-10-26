# Story: definition loader

Draft for review. I want to choose and freeze the exact editable recipe I requested.
The [owning prompt](../../prompts/cli/workflow-definition-loader.prompt.md) defines the contract.

## Observable acceptance criteria

- **AC1:** A complete valid local recipe owns the selected workflow.
- **AC2:** An existing invalid project recipe never silently falls back to the bundle.
- **AC3:** An absent local recipe permits bundled selection.
- **AC4:** Symlinked, traversing or undeclared instruction files are refused.
- **AC5:** Saved content includes every declared unique file in sorted order and changes digest when required bytes change.
- **AC6:** Callers cannot mutate returned stages or file snapshots.
- **AC7:** The upper stage limit is inclusive.
- **AC8:** A file equal to the size limit is permitted; a larger file is refused.
- **AC9:** Work or verified publication before the required accepted proposal and verify is invalid.
- **AC10:** A later work stage invalidates earlier graph verification until another verify.
- **AC11:** requiresMerge must name a preceding merge with a valid PR relationship.
- **AC12:** Discovery accepts safe custom names and sorts them without installing or running them.
- **AC13:** An invalid discovered recipe produces a useful error, not a partial successful catalog.

[Expected cases](../../vectors/cli/workflow-definition-loader.json) are independent synthetic
expectations. They are not observed program output or a claim that code ran.


## Round 2 acceptance

- **AC14:** Every proposal requires Story, prompt and independent case roles before implementation; omitted roles refuse the definition.
