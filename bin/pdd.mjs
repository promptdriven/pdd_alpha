#!/usr/bin/env node
// Generated from prompts/cli/bin-entry.prompt.md (sha256: fdda37103ee71dc8b1c4354b86106dab288bc61078732a2ba6c0a93762a96035).
import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { resolveRuntime } from '../src/versions.mjs';
import { readInstallRecord } from '../src/install-record.mjs';

const home = homedir();
const entry = await realpath(fileURLToPath(import.meta.url));
let runtime, selectionFailed = false;
try {
  const root = dirname(dirname(entry));
  if (dirname(root) === join(home, '.pdd/versions')) {
    runtime = await resolveRuntime({ home, versionRoot: root });
  } else {
    let managed = false;
    for (const name of ['current', 'install/record.json']) {
      try { await lstat(join(home, '.pdd', name)); managed = true; }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (managed) {
      const record = await readInstallRecord({ home });
      if (record.code || !record.value) throw new Error('managed record unavailable');
      runtime = await resolveRuntime({ home });
    }
  }
} catch {
  selectionFailed = true;
  process.stderr.write('runtime_unavailable: Run ~/.pdd/launcher/pdd-launch recover to repair the managed installation.\n');
  process.exitCode = 1;
}
if (!selectionFailed) {
  if (runtime && (runtime.bin !== entry || await realpath(process.execPath) !== runtime.node)) {
    const args = [runtime.node, runtime.bin, ...process.argv.slice(2)];
    // exec preserves pid, directed signals and the exact exit status. Older supported
    // Node builds without execve use a signal-forwarding argv-only handoff.
    if (typeof process.execve === 'function') {
      try { process.execve(runtime.node, args, process.env); }
      catch {
        process.stderr.write('runtime_unavailable: Run ~/.pdd/launcher/pdd-launch recover.\n');
        process.exitCode = 1;
      }
    }
    else {
      const child = spawn(runtime.node, args.slice(1), { stdio: 'inherit', env: process.env, cwd: process.cwd(), shell: false });
      const handlers = new Map();
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
        const handler = () => child.kill(signal); handlers.set(signal, handler); process.on(signal, handler);
      }
      await new Promise(done => {
        child.once('error', () => { process.stderr.write('runtime_unavailable: Run ~/.pdd/launcher/pdd-launch recover.\n'); process.exitCode = 1; done(); });
        child.once('exit', (code, signal) => {
          for (const [name, handler] of handlers) process.off(name, handler);
          if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1;
          done();
        });
      });
    }
  } else {
    const { runPdd } = await import('../src/pdd-cli.mjs');
    process.exitCode = await runPdd(process.argv.slice(2), runtime ? { ports: { runtime } } : undefined);
  }
}
