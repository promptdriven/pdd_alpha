// Generated from prompts/cli/detached-updater.prompt.md (sha256: 8c96d2c5165de3f53aa04be956dcf52cce8effc322397b324666f0dfe0bf1ae9).
import { runUpdate } from '../src/detached-updater.mjs';
const result = await runUpdate({ transactionId: process.argv[3] }, { home: process.argv[2] });
if (result.code) { process.stderr.write(`${result.code}: Retry through the authorized release selector.\n`); process.exitCode = 1; }
