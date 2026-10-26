// Generated from prompts/cli/pdd-launch.prompt.md (sha256: df97942d481fffe8e12f078eb034b628cbc049f63074219a02d00652d9d85878).
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
