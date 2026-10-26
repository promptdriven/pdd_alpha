// Generated from prompts/cli/pdd-launch.prompt.md (sha256: 5d009640b4a0c7043c54d65d672f789f647e19097c526acc13ce37626ba17681).
import { runLauncherCommand } from '../src/pdd-launch.mjs';
const result = await runLauncherCommand(process.argv.slice(2));
if (result?.code) { process.stderr.write(`${result.code}: ${result.next ?? 'Run pdd setup.'}\n`); process.exitCode = 1; }
else if (result) process.stdout.write(`${result.phase ?? 'ready'}\n`);
