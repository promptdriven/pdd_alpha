# Story: definitions

Draft for review. I want to see the bundled steps without a second hidden stage schema.
The [owning prompt](../../prompts/cli/workflow-definitions.prompt.md) defines the contract.

## Observable acceptance criteria

- **AC1:** The compatibility export keeps the three workflows and listed stage counts.
- **AC2:** Feature steps retain their exact semantic order.
- **AC3:** Optional stages stay listed rather than disappearing from the definition.
- **AC4:** Human, PR and merge steps create no native agent session.
- **AC5:** Callers cannot mutate definitions or stage entries.
- **AC6:** The compatibility export does not restrict loader selection to three names.

[Expected cases](../../vectors/cli/workflow-definitions.json) are independent synthetic
expectations. They are not observed program output or a claim that code ran.


## Round 2 acceptance

- **AC7:** The bundled small-change proposal has the same Story/prompt/cases specification gate as other recipes.
