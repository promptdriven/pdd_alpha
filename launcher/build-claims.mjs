// Generated from prompts/cli/packaging.prompt.md (sha256: 9bb5314bfef6f7258304e3a33514ebd46df9afe267db2be0fc68dcdbdc60b4dd).
// Release-platform preparation only; package installation never runs a compiler.
import { mkdir, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
if (!['linux', 'darwin'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('unsupported_runtime');
const directory = fileURLToPath(new URL(`./native/${process.platform}-${process.arch}/`, import.meta.url));
await mkdir(directory, { recursive: true });
const destination = `${directory}/pdd-flock`;
const temporary = `${destination}.${process.pid}.tmp`;
try {
  await promisify(execFile)('cc', ['-O2', '-Wall', '-Wextra', '-Werror', fileURLToPath(new URL('../src/workflow-flock.c', import.meta.url)), '-o', temporary]);
  await rename(temporary, destination);
} finally { await rm(temporary, { force: true }); }
