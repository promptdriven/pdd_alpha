# Story: choose a valid native model and effort

Draft for review. As a person starting an agent or workflow, I want valid choices from the selected machine and useful defaults, so a launch preserves the model and effort I chose.

The [owning prompt](../../prompts/cli/workflow-models.prompt.md) defines the contract.

## Observable acceptance criteria

- **AC1:** Catalogs come from the selected machine and installed CLI, filter hidden models, and expose only each model’s supported efforts.
- **AC2:** Claude effort options require observed model/plan acceptance; unavailable evidence never produces a guessed list or paid probe.
- **AC3:** Unspecified launch selections use per-tool Settings defaults or the observed native defaults when Settings is unset.
- **AC4:** Explicit model/effort overrides are validated as a pair before launch; unsupported explicit values are refused without downgrade.
- **AC5:** An override model with no effort keeps a compatible Settings effort or uses that model’s observed default.
- **AC6:** Workflows freeze the accepted pair at start; later defaults change future runs and unsupported recovery is blocked.
- **AC7:** Strict discovery/Settings validation refuses unavailable evidence. Launches with a missing native list use Settings defaults, otherwise omit model/effort flags; print one safe warning and continue. Wrong target identity still refuses before effects.
- **AC9:** Recovery preserves the frozen Settings pair or native-default policy while the list is unavailable; an available list still rejects an unsupported saved pair.
- **AC8:** Account policy grants no model change or cross-tool permission; permitted cross-tool successors validate their target defaults separately.

[Expected cases](../../vectors/cli/workflow-models.json) are synthetic independent expectations, not implementation or live-service results.
