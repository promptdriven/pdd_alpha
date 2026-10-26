# Story: native agent launch flags

Examples are synthetic.

## Request and scope

As a person who starts Codex or Claude through `pdd session`, a workflow stage
or the phone, I want every launch to get the same full-access, trust and resume
arguments, and the model and effort I chose, from one place, so that a launch from the phone, from the terminal or from a Herdr restore behaves
the same way and the modes never drift apart. Starting the
process, the positional prompt, the Herdr `--` boundary and the choice of the
folder stay with the callers and are out of scope. The owning prompt is
[native launch flags](../../prompts/cli/native-flags.prompt.md).

## Observable acceptance criteria

- **AC1:** A fresh Codex full-access call returns exactly `--no-daemon`,
  `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`,
  `-c` and one trust element `projects={"<cwd>"={trust_level="trusted"}}`, in
  that order. The hook-trust flag comes right after the sandbox flag, so the
  Herdr session hook does not stop the agent at "Hooks need review".
- **AC2:** The trust element is one argv element. Its key is the plain root key
  `projects`. The folder is a TOML basic string inside the value: `\` and `"`
  are escaped, control characters and U+007F are escaped, and spaces, dots,
  `=` and `'` stay unchanged.
- **AC3:** A fresh Claude full-access call returns exactly
  `--dangerously-skip-permissions`.
- **AC4:** With `fullAccess: false` no permission, hook-trust or trust
  element appears. Codex returns only `--no-daemon`; Claude returns an empty
  list.
- **AC5:** A Codex resume returns `resume`, then the flags for the selected
  access, then the id. A Claude resume returns the flags for the selected
  access, then `--resume` and the id.
- **AC6:** A missing `fullAccess` means `true`; an explicit `false` stays
  `false`. A missing or `null` `resume` means a fresh launch.
- **AC7:** A caller bug throws `TypeError`: an unknown or differently cased
  agent, a missing, relative or empty `cwd`, a `cwd` with U+0000, a
  non-boolean `fullAccess` (including `null`) and a `resume` that is not UUID
  text.
- **AC8:** The result never holds the executable name, a prompt, a Herdr `--`
  or any other flag. Without a `selection` there is no model or effort flag. Two equal calls give equal, separate arrays, and the
  input object is unchanged.

- **AC9:** A validated `selection` adds the model and effort flags after the
  access flags and before a resume id: Codex `-m <model>` and, with an effort,
  one element `-c` and one element `model_reasoning_effort="<effort>"`; Claude
  `--model <model>` and, with an effort, `--effort <effort>`. A `null` effort
  adds the model only. A malformed `selection` throws `TypeError`.

The independently authored [expected cases](../../vectors/cli/native-flags.json)
map inputs to these criteria. Expected values come from the contract, not from
running code.
