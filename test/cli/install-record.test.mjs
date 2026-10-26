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
  const attemptId = c.given.pendingAttempt ?? c.given.attemptId ?? 'A2';
  const initial = await seed(home, { futureField: { keep: true }, starts: { R2: start(rt, count, pending(attemptId)) } });
  assert.equal(initial.code, null);
  if (['duplicate-exit', 'deadline-counted-once', 'success-resets-counter', 'link-clears-unresolved-entry', 'unknown-process-proof'].includes(c.id)) {
    const success = ['success-resets-counter', 'link-clears-unresolved-entry'].includes(c.id);
    const p = { processState: () => c.id === 'unknown-process-proof' ? 'unknown' : c.id === 'deadline-counted-once' ? 'live' : 'dead', now: () => ({ bootId: 'B1', elapsedMs: 600000 }), terminateProcess: async () => {}, readReady: async () => success ? { attemptId, releaseId: 'R2', bootId: 'B1', processProof: proof, readyAt: 1000 } : null };
    const first = await reconcileStartup({ home }, p), read = await readInstallRecord({ home });
    if (c.id === 'unknown-process-proof') { assert.equal(first.code, c.expected.code); assert.equal(read.value.starts.R2.consecutiveFailures, c.expected.failures); return; }
    const second = await reconcileStartup({ home }, p), again = await readInstallRecord({ home });
    assert.equal(again.value.starts.R2.consecutiveFailures, c.expected.failures);
    if (success) { assert.equal(again.value.starts.R2.pending, null); assert.equal(again.value.starts.R2.lastSuccess, c.expected.lastSuccess); }
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
  const from = c.id === 'activation-intent-survives' ? await runtime(home, c.given.from, { client: true }) : null;
  const changed = await mutate(home, next => {
    if (c.id === 'activation-intent-survives') next.transaction = { id: 'T1', restartRequired: false, manifestSeq: 1, error: null, ...c.given, from, to: rt };
    if (c.id === 'rejection-survives-seq-edit') next.rejected.R2 = { alphaDigest: rt.alphaDigest, clientDigest: rt.clientDigest, reason: 'three_failed_starts', transactionId: 'T1' };
    if (c.id === 'offline-report-retry') next.reports = c.given.reports;
    if (c.id === 'persist-deadline-evidence') next.starts.R2.pending = pending('A1', { ...c.given });
    if (c.id === 'concurrent-stage-checkpoint-preserves-owner') { next.transaction = { id: 'T0', phase: 'locked' }; next.staging = { T1: { phase: 'checked' }, T2: { phase: 'downloading' } }; }
  });
  assert.equal(changed.code, null); const read = (await readInstallRecord({ home })).value;
  assert.deepEqual(read.futureField, { keep: true });
  assert.equal((await fs.stat(join(home, '.pdd/install/record.json'))).mode & 0o777, 0o600);
  if (c.id === 'activation-intent-survives') { assert.deepEqual(read.transaction.from, from); assert.deepEqual(read.transaction.to, rt); assert.equal(read.transaction.from.releaseId, c.expected.from); assert.equal(read.transaction.to.releaseId, c.expected.to); assert.equal(read.transaction.barrierId, c.expected.barrierId); }
  if (c.id === 'rejection-survives-seq-edit') assert.ok(read.rejected[c.expected.rejectedRelease]);
  if (c.id === 'offline-report-retry') assert.equal(read.reports[0].id, c.expected.reportId);
  if (c.id === 'persist-deadline-evidence') assert.equal(read.starts.R2.pending.deadlineAt, c.expected.deadlineAt);
  if (c.id === 'concurrent-stage-checkpoint-preserves-owner') { assert.equal(read.transaction.id, 'T0'); assert.equal(read.staging.T2.phase, 'downloading'); }
});


for (const kind of ['fifo', 'directory', 'symlink']) test(`unusable ${kind} install record returns finite read-only status`, async t => {
  const { spawnSync } = await import('node:child_process');
  const home = await temporary(t), record = join(home, '.pdd/install/record.json');
  await fs.mkdir(join(home, '.pdd/install'), { recursive: true, mode: 0o700 });
  if (kind === 'fifo') {
    const made = spawnSync('mkfifo', ['-m', '600', record], { encoding: 'utf8', timeout: 2500 });
    assert.equal(made.status, 0, made.stderr);
  } else if (kind === 'directory') await fs.mkdir(record, { mode: 0o700 });
  else {
    const target = join(home, 'record-target.json');
    await fs.writeFile(target, JSON.stringify({ v: 1, rev: 0, transaction: null, staging: {}, starts: {}, rejected: {}, reports: [] }));
    await fs.symlink(target, record);
  }
  const before = await fs.lstat(record);
  // A subprocess bound detects an indefinite FIFO read without leaving a reader behind.
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { readInstallRecord } from ${JSON.stringify(new URL('../../src/install-record.mjs', import.meta.url).href)};
    import { runUpdateCommand } from ${JSON.stringify(new URL('../../src/update-command.mjs', import.meta.url).href)};
    const home = process.argv[1];
    console.log(JSON.stringify({ record: await readInstallRecord({ home }), status: await runUpdateCommand({}, { home }) }));
  `, home], { encoding: 'utf8', timeout: 2500, killSignal: 'SIGKILL' });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.deepEqual(result.record, { value: null, code: 'record_io' });
  assert.equal(result.status.state, 'shown'); assert.equal(result.status.code, 0);
  assert.match(result.status.message, /Local update record could not be read/);
  const after = await fs.lstat(record);
  for (const field of ['dev', 'ino', 'mode', 'size', 'mtimeMs']) assert.equal(after[field], before[field], field);
  assert.deepEqual((await fs.readdir(join(home, '.pdd'))).sort(), ['install']);
  assert.deepEqual(await fs.readdir(join(home, '.pdd/install')), ['record.json']);
});
