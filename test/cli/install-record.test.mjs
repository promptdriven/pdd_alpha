import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { withUpdateLock } from '../../src/update-lock.mjs';
import { readInstallRecord, writeInstallRecord } from '../../src/install-record.mjs';
import { reconcileStartup } from '../../src/pdd-launch.mjs';
import { cases, temporary, runtime, pointer, put, seed, mutate, start, pending, proof } from './pkg-fixtures.mjs';

for (const c of await cases('install-record')) test(c.id, async t => {
  const home = await temporary(t), rt = await runtime(home, 'R2', { client: true }); await pointer(home, 'current', rt);
  if (c.id === 'corrupt-json') {
    const path = join(home, '.pdd/install/record.json'); await put(path, c.given.recordBytes);
    assert.equal((await readInstallRecord({ home })).code, c.expected.code);
    assert.equal((await withUpdateLock({ home }, lease => writeInstallRecord({ home, lease, expectedRev: 0, next: {} }))).code, c.expected.code);
    assert.equal(await fs.readFile(path, 'utf8'), c.expected.recordBytes); return;
  }
  const count = c.id === 'success-resets-counter' || c.id === 'link-clears-unresolved-entry' ? 2 : 1;
  const initial = await seed(home, { futureField: { keep: true }, starts: { R2: start(rt, count, pending('A2')) } });
  assert.equal(initial.code, null);
  if (['duplicate-exit', 'deadline-counted-once', 'success-resets-counter', 'link-clears-unresolved-entry', 'unknown-process-proof'].includes(c.id)) {
    const success = ['success-resets-counter', 'link-clears-unresolved-entry'].includes(c.id);
    const p = { processState: () => c.id === 'unknown-process-proof' ? 'unknown' : c.id === 'deadline-counted-once' ? 'live' : 'dead', now: () => ({ bootId: 'B1', elapsedMs: 600000 }), terminateProcess: async () => {}, readReady: async () => success ? { attemptId: 'A2', releaseId: 'R2', bootId: 'B1', processProof: proof, readyAt: 1000 } : null };
    const first = await reconcileStartup({ home }, p), read = await readInstallRecord({ home });
    if (c.id === 'unknown-process-proof') { assert.equal(first.code, c.expected.code); assert.equal(read.value.starts.R2.consecutiveFailures, c.expected.failures); return; }
    const second = await reconcileStartup({ home }, p), again = await readInstallRecord({ home });
    assert.equal(again.value.starts.R2.consecutiveFailures, c.expected.failures);
    if (success) { assert.equal(again.value.starts.R2.pending, null); assert.equal(again.value.starts.R2.lastSuccess, 'A2'); }
    else assert.equal(read.value.starts.R2.consecutiveFailures, again.value.starts.R2.consecutiveFailures);
    return;
  }
  if (c.id === 'write-without-lease') {
    assert.equal((await writeInstallRecord({ home, lease: {}, expectedRev: 1, next: {} })).code, 'lock_unavailable');
    assert.equal((await readInstallRecord({ home })).value.rev, 1); return;
  }
  if (c.id === 'revision-conflict') {
    const before = await readInstallRecord({ home });
    const written = await withUpdateLock({ home }, lease => writeInstallRecord({ home, lease, expectedRev: 0, next: { reports: [] } }));
    assert.equal(written.code, c.expected.code); assert.deepEqual((await readInstallRecord({ home })).value, before.value); return;
  }
  if (c.id === 'disk-full-before-rename') {
    const before = await fs.readFile(join(home, '.pdd/install/record.json'));
    const result = await withUpdateLock({ home }, lease => writeInstallRecord({ home, lease, expectedRev: 1, next: { reports: [] } }, { fs: { ...fs, open: async () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); } } }));
    assert.equal(result.code, c.expected.code); assert.deepEqual(await fs.readFile(join(home, '.pdd/install/record.json')), before); return;
  }
  if (c.id === 'unknown-phase') {
    const result = await mutate(home, next => next.transaction = { phase: c.given.phase });
    assert.equal(result.code, c.expected.code); assert.equal((await readInstallRecord({ home })).value.transaction, null); return;
  }
  const changed = await mutate(home, next => {
    if (c.id === 'activation-intent-survives') next.transaction = { id: 'T1', ...c.given };
    if (c.id === 'rejection-survives-seq-edit') next.rejected.R2 = { alphaDigest: rt.alphaDigest, clientDigest: rt.clientDigest, reason: 'three_failed_starts', transactionId: 'T1' };
    if (c.id === 'offline-report-retry') next.reports = c.given.reports;
    if (c.id === 'persist-deadline-evidence') next.starts.R2.pending = pending('A1', { ...c.given });
    if (c.id === 'concurrent-stage-checkpoint-preserves-owner') { next.transaction = { id: 'T0', phase: 'locked' }; next.staging = { T1: { phase: 'checked' }, T2: { phase: 'downloading' } }; }
  });
  assert.equal(changed.code, null); const read = (await readInstallRecord({ home })).value;
  assert.deepEqual(read.futureField, { keep: true });
  assert.equal((await fs.stat(join(home, '.pdd/install/record.json'))).mode & 0o777, 0o600);
  if (c.id === 'activation-intent-survives') { assert.equal(read.transaction.from, c.expected.from); assert.equal(read.transaction.to, c.expected.to); assert.equal(read.transaction.barrierId, c.expected.barrierId); }
  if (c.id === 'rejection-survives-seq-edit') assert.ok(read.rejected[c.expected.rejectedRelease]);
  if (c.id === 'offline-report-retry') assert.equal(read.reports[0].id, c.expected.reportId);
  if (c.id === 'persist-deadline-evidence') assert.equal(read.starts.R2.pending.deadlineAt, c.expected.deadlineAt);
  if (c.id === 'concurrent-stage-checkpoint-preserves-owner') { assert.equal(read.transaction.id, 'T0'); assert.equal(read.staging.T2.phase, 'downloading'); }
});
