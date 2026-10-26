// Generated from prompts/cli/update-lock.prompt.md (sha256: 2855f8b3608fe3f08f14957e1d2491a743e523cf7c3bb7685c98de71b15a7f94).
import { realpath } from 'node:fs/promises';
import { repairPrivatePddHome } from './pdd-directory.mjs';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = new WeakMap();
export const kernelLockHelper = fileURLToPath(new URL(`../launcher/native/${process.platform}-${process.arch}/pdd-lock`, import.meta.url));
export function validUpdateLease(lease, home) {
  const state = lease && owned.get(lease);
  return Boolean(state?.active && state.pid === process.pid && state.home === resolve(home));
}

export async function withUpdateLock({ home, onWait, signal }, operation, ports = {}) {
  if (signal?.aborted) return { code: 'cancelled' };
  const root = resolve(home);
  let child;
  try {
    await repairPrivatePddHome(join(root, '.pdd'));
    // Refuse an aliased installation directory, rather than locking another tree.
    if (await realpath(join(root, '.pdd')) !== join(root, '.pdd')) return { code: 'lock_unavailable' };
    child = (ports.spawn ?? spawn)(ports.lockHelper ?? kernelLockHelper, ['--hold', join(root, '.pdd/update.lock')], { stdio: ['pipe', 'pipe', 'ignore'] });
  } catch { return { code: 'lock_unavailable' }; }
  const lease = Object.freeze({});
  const state = { active: false, pid: process.pid, home: root };
  owned.set(lease, state);
  let ended = false;
  const completion = new Promise(resolveDone => {
    child.once('exit', () => { ended = true; state.active = false; resolveDone(); });
    child.once('error', () => { ended = true; state.active = false; resolveDone(); });
  });
  // EPIPE is possible when cancellation races acquisition.
  child.stdin.on('error', () => {});
  const acquired = await new Promise(resolveAcquired => {
    let buffer = '', waited = false, settled = false;
    const finish = code => { if (!settled) { settled = true; signal?.removeEventListener('abort', cancel); resolveAcquired(code); } };
    const cancel = () => { child.stdin.end(); child.kill(); finish('cancelled'); };
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', bytes => {
      buffer += bytes;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (line === 'WAIT' && !waited) { waited = true; try { onWait?.('Another setup or update is running. Waiting…'); } catch {} }
        if (line === 'LOCKED') finish(signal?.aborted ? 'cancelled' : null);
      }
    });
    completion.then(() => finish(signal?.aborted ? 'cancelled' : 'lock_unavailable'));
    if (signal?.aborted) cancel();
  });
  if (acquired || ended) { child.stdin.end(); await completion; return { code: acquired ?? 'lock_unavailable' }; }
  state.active = true;
  try { return await operation(lease); }
  finally { state.active = false; child.stdin.end(); await completion; }
}
