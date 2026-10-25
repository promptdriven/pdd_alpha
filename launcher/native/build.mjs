// Generated from prompts/cli/update-lock.prompt.md (sha256: b5ceabddd881784082c6ba881a599fd3509aa9757802b5ff0fde10f6c42595cb).
import { mkdir, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
if (!['linux', 'darwin'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('unsupported_runtime');
const directory = fileURLToPath(new URL(`./${process.platform}-${process.arch}/`, import.meta.url));
await mkdir(directory, { recursive: true });
const temporary = `${directory}/.pdd-lock-${process.pid}`;
try {
  await execute('cc', ['-O2', '-Wall', '-Wextra', '-Werror', fileURLToPath(new URL('./pdd-lock.c', import.meta.url)), '-o', temporary]);
  await rename(temporary, `${directory}/pdd-lock`);
} finally { await rm(temporary, { force: true }); }
