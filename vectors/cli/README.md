# Expected cases for the CLI modules

Each JSON file here lists independent expected cases for one module prompt in [`prompts/cli/`](../../prompts/cli/). Each case maps to the acceptance criteria of a Story in [`story/cli/`](../../story/cli/README.md). The shape follows the [ticket-status example](../../examples/ticket-status/vectors/status-labels.json), with a few more fields because these modules have effects.

These cases are drafts for review. No test in `test/` reads them yet. They are not a PDD execution schema, and `npm test` does not run them.

## File shape

```json
{
  "status": "draft",
  "prompt": "prompts/cli/argument-parser.prompt.md",
  "story": "story/cli/ARGUMENT-PARSER.md",
  "cases": [
    {
      "id": "session-agent-and-request-words",
      "criteria": ["AC1"],
      "given": "Optional plain description of the starting state.",
      "input": ["session", "--agent", "claude", "Draft", "a", "prompt"],
      "expected": { "commandId": "session", "operands": ["Draft", "a", "prompt"], "options": { "--agent": "claude" } }
    },
    {
      "id": "unknown-command-refused",
      "criteria": ["AC4"],
      "input": ["deploy"],
      "expectedError": { "class": "CommandInputError", "exitCode": 2 }
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `status` | `draft` until a person accepts the cases. |
| `prompt`, `story` | Repository-relative paths of the owning prompt and Story. |
| `given` (top level) | Optional. A starting state that every case in the file shares. |
| `id` | Stable kebab-case name, unique in the file. |
| `criteria` | Story acceptance criteria that the case checks. |
| `given` | Optional. The starting state in plain words, when the input alone is not enough. |
| `input` | Literal input: an argv array, a call argument object or a described event. |
| `expected` | Literal observable result. A partial object means "these fields have these values". |
| `expectedError` | Used instead of `expected`. Names the error class, exit code or result state. |
| `effects` | Optional. Observable effects that must or must not happen, such as `"no native launch"` or `"no push"`. |

## Rules for authors

- Write each expected value from the prompt and Story. Do not run the implementation to get it. Do not copy a value only because the code returns it.
- Expect structure, not wording: exit codes, states, fields, argv and effects. Do not pin exact message text.
- Cover normal behavior, boundaries, errors and forbidden effects.
- A case that is written but not run is a draft. It is not a pass.
