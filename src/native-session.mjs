// Generated from prompts/cli/native-session.prompt.md (sha256: ccd589b105544ab3fd80e927c770a6524796b88d0a9f9aaa9bd7b58778bf6ad3).
import { spawn as spawnChild } from 'node:child_process';
import { constants } from 'node:os';
import { resolve as resolvePath } from 'node:path';
import { nativeArgs } from './native-flags.mjs';

export function launchNativeSession({ agent, cwd, context, request = '', selection = null, stderr = process.stderr },
  { spawn = spawnChild, signals = process, stdinIsTTY = Boolean(process.stdin.isTTY) } = {}) {
  if (!['codex', 'claude'].includes(agent)) return Promise.resolve(2);
  const prompt = `${context}\n\n# Person request\n${request || 'Summarize the relevant Prompting guide method and available manual workflows, then ask what I want to work on. Do not draft a Story before that summary.'}`;
  return new Promise(resolve => {
    let child, settled = false, launchError;
    const listeners = [];
    const finish = code => {
      if (settled) return; settled = true;
      for (const [name, fn] of listeners) signals.removeListener(name, fn);
      resolve(code);
    };
    const failed = error => {
      launchError = error;
      stderr.write(error?.code === 'ENOENT'
        ? `The native ${agent} CLI is not on PATH. Install and sign in with that native tool, then run pdd session again.\n`
        : `The native ${agent} session could not be launched. Check that tool and the size of the bundled instructions.\n`);
    };
    try {
      const resolvedCwd = resolvePath(cwd);
      child = spawn(agent, [...nativeArgs({ agent, cwd: resolvedCwd, selection }), prompt], { cwd, stdio: 'inherit', shell: false });
    }
    catch (error) { failed(error); finish(error.code === 'ENOENT' ? 127 : 1); return; }
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const fn = () => {
        // The inherited foreground terminal already sends Ctrl-C to both processes.
        if (name === 'SIGINT' && stdinIsTTY) return;
        try { child.kill(name); } catch { /* Still wait for the real child close. */ }
      };
      signals.on(name, fn); listeners.push([name, fn]);
    }
    child.once('error', failed);
    child.once('close', (code, signal) => finish(launchError ? launchError.code === 'ENOENT' ? 127 : 1
      : Number.isInteger(code) ? code : constants.signals[signal] ? 128 + constants.signals[signal] : 1));
  });
}
