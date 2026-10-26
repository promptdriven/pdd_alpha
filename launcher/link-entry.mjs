// Generated from prompts/cli/pdd-launch.prompt.md (sha256: c0b65e50aa93bc642f892c1c73388d60a676b58efac3699a7d747b3acf201c63).
import { resolveRuntime } from '../src/versions.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const home = homedir();
const runtime = await resolveRuntime({ home, versionRoot: process.argv[2] });
const { runLink } = await import(pathToFileURL(join(runtime.versionRoot, 'client/src/phone/link/main.mjs')));
process.exitCode = await runLink({ linkDir: join(home, '.pdd/link'), packageRoot: join(runtime.versionRoot, 'client') });
