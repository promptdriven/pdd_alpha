// Generated from prompts/cli/pdd-launch.prompt.md (sha256: 56a04dc8c0bf164972c47d2e432a88854953e312307149008c426d93f22f8aba).
import { resolveRuntime } from '../src/versions.mjs';
import { commitStartupReady } from '../src/pdd-launch.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const home = homedir();
const runtime = await resolveRuntime({ home, versionRoot: process.argv[2] });
const { runLink } = await import(pathToFileURL(join(runtime.versionRoot, 'client/src/phone/link/main.mjs')));
process.exitCode = await runLink({ linkDir: join(home, '.pdd/link'), packageRoot: join(runtime.versionRoot, 'client') }, {
  startupReady: async () => {
    const result = await commitStartupReady({ home, attemptId: process.env.PDD_START_ATTEMPT });
    if (result.code) throw Object.assign(new Error(result.code), { code: result.code });
  }
});
