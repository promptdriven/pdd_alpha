# Story: decide on the current run revision

Draft for review. I want to approve or skip the run I just reviewed once,
from a terminal or the phone. A retry must not repeat work. If the run changed,
PDD must ask me to look again. The controller must use the run's saved version.

[Owning prompt](../../prompts/cli/workflow-decide.prompt.md).

## Observable acceptance criteria

- **AC1:** Current rev proof: state = "started"; exitCode = 0; driveLineVersion = "old"; paneRunCount = 1; decisionDoneFromStartAlone = false.
- **AC2:** Stale rev: state = "refused"; code = "stale_decision"; exitCode = 1; effects = 0.
- **AC3:** Heartbeat does not stale: revMatches = true.
- **AC4:** Recorded before stale: state = "recorded"; exitCode = 0; writes = 0; herdrCalls = 0.
- **AC5:** Id payload changed: state = "refused"; code = "bad_args"; effects = 0.
- **AC6:** Same id new revision: state = "refused"; code = "bad_args"; effects = 0.
- **AC7:** Intent uncertain: state = "uncertain"; newLaunches = 0.
- **AC8:** Typed without proof: state = "uncertain"; exitCode = 1; paneRunCount = 1.
- **AC9:** Legacy pair: state = "started"; legacyExactChecks = true.
- **AC10:** Both bindings required: state = "refused"; code = "stale_decision"; effects = 0.
- **AC11:** Completed: state = "refused"; code = "stale_decision"; effects = 0.
- **AC12:** Held controller: state = "refused"; code = "run_not_waiting"; effects = 0.
- **AC13:** Unknown controller lock: state = "refused"; code = "run_not_waiting"; effects = 0.
- **AC14:** Status is not authority: state = "refused"; code = "run_not_waiting"; effects = 0.
- **AC15:** Damaged history: state = "failed"; effects = 0.
- **AC16:** Incomplete decision scan: state = "failed"; effects = 0.
- **AC17:** Changed artifacts: semanticDecisionAccepted = false; stageEffects = 0.
- **AC18:** Json result: stdoutLines = 1; jsonVersion = 1; exitCodeFieldOnStdout = false; messagePrintedTwice = false.
- **AC19:** Text result: stdoutLines = 1; stdoutIsResultMessage = true; exitCode = 1.
- **AC20:** Unknown run: state = "refused"; code = "unknown_run"; effects = 0.
- **AC21:** Unsafe runtime: state = "refused"; code = "unsupported"; effects = 0.
- **AC22:** Server absent: code = "herdr_not_running"; serverStarts = 0.
- **AC23:** Before first effect fsync: state = "failed"; herdrEffects = 0.
- **AC24:** Unadopted old run: controllerStarts = 0; stagePrompts = 0.
- **AC25:** Invalid ids, revision boundaries, enums or expected-field combinations fail bad_args before reads. CLI unknown/repeated options exit 2.

[Expected cases](../../vectors/cli/workflow-decide.json) are independently written synthetic expectations. They are not test results.
