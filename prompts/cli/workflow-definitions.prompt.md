# Workflow stage definitions

Owns `src/workflow-definitions.mjs`. Exports the frozen constant `WORKFLOW_STAGES`, which the [workflow runner](workflow-runner.prompt.md) re-exports from `src/workflow-runner.mjs`.

`WORKFLOW_STAGES` is a compatibility export: the stage lists of the bundled workflow definitions `feature`, `bug` and `small-change`, in one plain object. The bundled `workflow.json` files are the only source of these stages. The module derives the export through the definition loader when it is first imported, so it keeps no second copy of stage order, kinds or schema. It takes no call input. [Bundled workflows](bundled-workflows.prompt.md) says what each definition contains.

Preservation: behavioral refinement. Keep the constant's name and binding kind, its three keys and their order, the loader's stage entries unchanged, deep frozenness, and import failure for an invalid bundled definition. How the module calls the loader and builds the object may vary.

## Derivation and failure

- Load each name with the loader, with both `cwd` and `packageRoot` set to the package root (the folder above `src/`). Reason: the export describes the bundled definitions, so a `.pdd/workflows/<name>` folder in the caller's project must not change it.
- If the loader refuses a definition, its error propagates and the import fails. Importing the runner then fails too. Never substitute a partial, empty or hardcoded list, because a hardcoded list can drift from the files.
- The module reads only what the loader reads. It writes nothing and starts no Git, native agent, GitHub or network work.

## Export shape

`WORKFLOW_STAGES` is a plain object with exactly the own keys `feature`, `bug` and `small-change`, in that order, even if the package bundles more definitions. Each value is the loader's `stages` array for that name, in `workflow.json` order. Each entry is the loader's normalized stage record, unchanged. Add, remove, rename or reorder no entry or field.

| Kind | Fields beside `id`, `kind`, `file` and `optional` |
| --- | --- |
| `agent` | `protocol`; `requiredRoles` (`[]` when omitted); `approval` and `requiresMerge` when declared |
| `human` | None |
| `pr` | `publication`; `requiresMerge` when declared |
| `merge` | `prStage` |

`optional` is always a boolean. It is `false` when the definition omits it. The [definition loader](workflow-definition-loader.prompt.md) owns the meaning of every field.

Everything is frozen: the object, each array, each entry and each `requiredRoles` array. A caller's write changes nothing. In strict-mode code, the write throws `TypeError`.

## Not a workflow catalog

This export does not limit which workflows exist. `workflow run`, `workflow resume` and `workflow list` select definitions by name through the loader, which accepts any valid project or bundled name. Do not use `WORKFLOW_STAGES` as an allow list or a source of stage policy. Do not add stage kinds, derived fields or names here.

## Dependencies

- [Prompting guide](../../docs/prompting-guide.md) — authoring and review method for this prompt.
- [Definition loader](workflow-definition-loader.prompt.md) — generation, runtime and testing. The module function `loadWorkflowDefinition({ name, cwd, packageRoot })` returns a deep-frozen definition or throws. This module exports its `stages`.
- [Bundled workflows](bundled-workflows.prompt.md) — owner of `.pdd/workflows/{feature,bug,small-change}/`: stage order, kinds and protocols. Runtime input through the loader. Testing: the expected stage lists.
- Node built-in `node:url` — runtime. `fileURLToPath` finds the package root from this module's own URL.
