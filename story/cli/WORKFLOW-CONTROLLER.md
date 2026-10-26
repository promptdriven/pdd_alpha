# Story: controller

Draft for review. As a person using PDD, I want to start a run in my normal Herdr session and know whether its controller actually started.
The [owning prompt](../../prompts/cli/workflow-controller.prompt.md) defines behavior.
These synthetic observations are independent expected cases, not execution results.

## Observable acceptance criteria

- **AC1:** A matching process and journal generation prove one controller in its own pane.
- **AC2:** A typed line without process proof stays uncertain; the controller command is not repeated.
- **AC3:** A lost typing reply can still report started when one pane has the exact process and generation.
- **AC4:** Wrong node: state = "uncertain"; stagePrompts = 0.
- **AC5:** Reused pid: state = "uncertain".
- **AC6:** Failed intent durability creates no run tab and delivers no controller command.
- **AC7:** Saved runtime: launchVersion = "old"; launchNode = "saved owned Node".
- **AC8:** Unsafe path: state = "refused"; code = "unsupported"; effects = 0.
- **AC9:** An unresolved prior intent creates no new tab and delivers no new controller command.
- **AC10:** Focus and ownership: session = "default"; newRunTab = true; focusChanged = false; typedExistingPanes = false.

[Expected cases](../../vectors/cli/workflow-controller.json). Case keys express observations;
they do not invent a product wire format. No implementation or live test ran.


## Locked plan observations

- **AC11:** Live without generation: state = "uncertain"; started = false.
- **AC12:** Wrong controller generation: state = "uncertain"; started = false.
