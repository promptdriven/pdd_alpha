// Generated from prompts/cli/update-lock.prompt.md (sha256: 2855f8b3608fe3f08f14957e1d2491a743e523cf7c3bb7685c98de71b15a7f94).
import { mkdir, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
if (!['linux', 'darwin'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('unsupported_runtime');
const directory = fileURLToPath(new URL(`./${process.platform}-${process.arch}/`, import.meta.url));
await mkdir(directory, { recursive: true });
for (const name of ['pdd-lock', 'pdd-directory']) {
  const temporary = `${directory}/.${name}-${process.pid}`;
  try {
    await execute('cc', ['-O2', '-Wall', '-Wextra', '-Werror', fileURLToPath(new URL(`./${name}.c`, import.meta.url)), '-o', temporary]);
    await rename(temporary, `${directory}/${name}`);
  } finally { await rm(temporary, { force: true }); }
}
