// Generated from prompts/cli/pdd-launch.prompt.md (sha256: 56a04dc8c0bf164972c47d2e432a88854953e312307149008c426d93f22f8aba).
import { runLauncherCommand } from '../src/pdd-launch.mjs';
const result = await runLauncherCommand(process.argv.slice(2));
if (result?.code) { process.stderr.write(`${result.code}: ${result.next ?? 'Run pdd setup.'}\n`); process.exitCode = 1; }
else if (result) process.stdout.write(`${result.phase ?? 'ready'}\n`);
