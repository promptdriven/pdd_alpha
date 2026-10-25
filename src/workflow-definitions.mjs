// Generated from prompts/cli/workflow-definitions.prompt.md (sha256: 986c4859dc402ab8c281fc977408b6f10002f82c63542bfe366d8342e2265455).
import { fileURLToPath } from 'node:url';
import { loadWorkflowDefinition } from './workflow-definition-loader.mjs';
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const WORKFLOW_STAGES = Object.freeze(Object.fromEntries(
  ['feature', 'bug', 'small-change'].map(name => [name,
    loadWorkflowDefinition({ name, cwd: packageRoot, packageRoot }).stages])));
