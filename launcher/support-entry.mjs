// Generated from prompts/cli/pdd-launch.prompt.md (sha256: df97942d481fffe8e12f078eb034b628cbc049f63074219a02d00652d9d85878).
import { runLauncherCommand } from '../src/pdd-launch.mjs';
const result = await runLauncherCommand(process.argv.slice(2));
if (result?.code) { process.stderr.write(`${result.code}: ${result.next ?? 'Run pdd setup.'}\n`); process.exitCode = 1; }
else if (result) process.stdout.write(`${result.phase ?? 'ready'}\n`);
