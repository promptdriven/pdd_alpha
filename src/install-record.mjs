// Generated from prompts/cli/install-record.prompt.md (sha256: 94bbb9939a9f7379b0bbf71494783c2584ba41641c16c5db730aa838f40fc392).
import * as fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validUpdateLease } from './update-lock.mjs';

const phases = new Set(['locked', 'staged', 'checked', 'activating', 'flipped', 'link_restarted', 'ready', 'rolling_back', 'rolled_back']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function initialInstallRecord() {
  return { v: 1, rev: 0, transaction: null, staging: {}, starts: {}, rejected: {}, reports: [] };
}
function inspect(v) {
  if (!object(v) || v.v !== 1 || !Number.isSafeInteger(v.rev) || v.rev < 0 || !object(v.staging) || !object(v.starts) || !object(v.rejected) || !Array.isArray(v.reports) || !(v.transaction === null || object(v.transaction))) return 'record_damaged';
  if (v.transaction && !phases.has(v.transaction.phase)) return 'recovery_required';
  if (Object.values(v.staging).some(s => !object(s) || !['downloading', 'staged', 'checked', 'failed'].includes(s.phase))) return 'recovery_required';
  for (const s of Object.values(v.starts)) {
    if (!object(s) || !Number.isSafeInteger(s.consecutiveFailures) || s.consecutiveFailures < 0 || !(s.pending === null || object(s.pending))) return 'record_damaged';
    if (s.pending && !['starting', 'ready', 'failed'].includes(s.pending.state)) return 'recovery_required';
  }
  return null;
}
export async function readInstallRecord({ home }, ports = {}) {
  const io = ports.fs ?? fs;
  try {
    const value = JSON.parse(await io.readFile(join(home, '.pdd/install/record.json'), 'utf8'));
    return { value, code: inspect(value) };
  } catch (e) { return { value: null, code: e.code === 'ENOENT' ? null : e instanceof SyntaxError ? 'record_damaged' : 'record_io' }; }
}
function merge(old, next) {
  if (!object(old) || !object(next)) return structuredClone(next);
  const out = structuredClone(old);
  for (const [key, value] of Object.entries(next)) Object.defineProperty(out, key, { value: merge(old[key], value), enumerable: true, writable: true, configurable: true });
  return out;
}
export async function durableJson(path, value, io = fs) {
  const directory = path.slice(0, path.lastIndexOf('/'));
  await io.mkdir(directory, { recursive: true, mode: 0o700 });
  if (await io.realpath(directory) !== resolve(directory)) throw new Error('aliased record directory');
  const tmp = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await io.open(tmp, 'wx', 0o600);
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync(); await file.close(); file = null;
    await io.rename(tmp, path);
    const dir = await io.open(directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } finally { await file?.close().catch(() => {}); await io.unlink(tmp).catch(() => {}); }
}
export async function writeInstallRecord({ home, lease, expectedRev, next }, ports = {}) {
  if (!validUpdateLease(lease, home)) return { value: null, code: 'lock_unavailable' };
  const before = await readInstallRecord({ home }, ports);
  if (before.code) return before;
  const current = before.value ?? initialInstallRecord();
  if (current.rev !== expectedRev) return { value: before.value, code: 'stale_record' };
  const value = merge(current, next);
  value.rev = current.rev + 1;
  const code = inspect(value);
  if (code) return { value: before.value, code };
  try {
    if (!validUpdateLease(lease, home)) return { value: before.value, code: 'lock_unavailable' };
    await durableJson(join(home, '.pdd/install/record.json'), value, ports.fs ?? fs);
    return { value, code: null };
  } catch { return { value: before.value, code: 'record_io' }; }
}
