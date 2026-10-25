# Confirm scope and observable expectations

Before drafting any Story, read the **entire** [Prompting guide](../../../docs/prompting-guide.md) into this agent conversation, including in an existing chat. Summarize the relevant method: describe what and why, preserve observable behavior and consequential edge cases, give each rule one owner, and keep expected results independent of implementation. Then apply it. A link, filename, prior chat summary or format check does not load the guide. If the file is unavailable, ask for its contents before drafting.

Read repository instructions and the affected public behavior. State the requested result, affected surface, why it is contained and how to undo it. Identify a concrete expected output or error independently of implementation when behavior changes.

Use the authorization already given. Resolve material ambiguity before expanding the edit; do not turn a contained task into broad prompt adoption or require a new Story for a trivial correction.

In an explicit saved workflow run, this is the proposal stage: supply the owning prompt, Story and independent cases as actual files, together with the concrete native test argv plan. The runner pauses for a current advance before implementation. Manual use keeps the contained-edit guidance above.
