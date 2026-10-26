// Generated from prompts/cli/pdd-launch.prompt.md (sha256: 5d009640b4a0c7043c54d65d672f789f647e19097c526acc13ce37626ba17681).
import { resolveRuntime } from '../src/versions.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const home = homedir();
const runtime = await resolveRuntime({ home, versionRoot: process.argv[2] });
const { runLink } = await import(pathToFileURL(join(runtime.versionRoot, 'client/src/phone/link/main.mjs')));
process.exitCode = await runLink({ linkDir: join(home, '.pdd/link'), packageRoot: join(runtime.versionRoot, 'client') });
