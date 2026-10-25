import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { reconcileStartup, prepareLinkStart, recordExecFailure, commitStartupReady, runLauncherCommand, recoveryServiceFiles, provisionRecoveryService } from '../../src/pdd-launch.mjs';
import { withUpdateLock } from '../../src/update-lock.mjs';
import { readInstallRecord } from '../../src/install-record.mjs';
import { cases, temporary, runtime, pointer, seed, mutate, start, pending, proof } from './pkg-fixtures.mjs';

for (const c of await cases('pdd-launch')) test(c.id, async t => {
  const home = await temporary(t), r1 = await runtime(home, 'R1', { client: true }), r2 = await runtime(home, 'R2', { client: true });
  await pointer(home, 'current', r2);
  if (c.id !== 'no-valid-previous') await pointer(home, 'previous', r1);
  let status = 'dead', elapsedMs = 1000, ready = null, terminations = 0, armed = 0;
  const ports = { home, processState: () => status, selfProof: () => proof, now: () => ({ bootId: 'B1', elapsedMs }), readReady: () => ready, clearReady: () => { ready = null; }, armStartupDeadline: () => { armed++; return { id: `D${armed}` }; }, terminateProcess: async p => { assert.deepEqual(p, proof); terminations++; status = 'dead'; } };
  const success = ['ready-then-fast-exit', 'ready-with-hosted-parts-down', 'ready-before-deadline'].includes(c.id);
  const third = ['three-exits-before-ready', 'reboot-between-failures', 'exec-failure-counts', 'no-valid-previous', 'rollback-offline-report', 'three-startup-hangs', 'automatic-rollback-ignores-floor'].includes(c.id);
  const failures = third ? 2 : success ? 2 : 1;
  await seed(home, { starts: { R2: start(r2, failures, pending('A2')) } });
  if (c.id === 'alpha-only-local-recovery') {
    let invoked;
    const result = await runLauncherCommand(['cli', '--version'], { ...ports, exec: (file, args) => { invoked = { file, args }; return { code: null }; } });
    assert.equal(result.code, null); assert.equal(invoked.file, r2.node); assert.deepEqual(invoked.args.slice(1), [r2.bin, '--version']); return;
  }
  if (['linux-rapid-failure-survival', 'mac-service-survival'].includes(c.id)) {
    const files = recoveryServiceFiles({ home, platform: c.given.platform });
    assert.equal(files.length, 1); assert.ok(files[0].text.includes(join(home, '.pdd/launcher/pdd-launch')));
    assert.equal(files[0].text.includes(r2.versionRoot), false);
    if (c.given.platform === 'linux') assert.ok(files[0].text.includes('StartLimitIntervalSec=0'));
    else assert.ok(files[0].text.includes('<key>AbandonProcessGroup</key><true/>'));
    return;
  }
  if (c.id === 'missing-platform-deadline') {
    await mutate(home, n => n.starts.R2.pending = null);
    const before = (await readInstallRecord({ home })).value.starts.R2.consecutiveFailures;
    const result = await prepareLinkStart({ home }, { ...ports, armStartupDeadline: async () => ({ code: 'startup_deadline_unavailable' }) });
    assert.equal(result.code, c.expected.code); assert.equal((await readInstallRecord({ home })).value.starts.R2.consecutiveFailures, before); return;
  }
  if (c.id === 'exec-does-not-retain-parent') {
    await mutate(home, n => n.starts.R2.pending = null);
    const result = await prepareLinkStart({ home }, ports);
    assert.equal(result.code, null); assert.deepEqual(result.attempt.processProof, proof); assert.equal(armed, 1);
    assert.equal(result.attempt.deadlineAt - result.attempt.startedAt, 600000); return;
  }
  if (c.id === 'exec-shim-reinvoked-live-candidate') {
    status = 'live'; const result = await prepareLinkStart({ home }, ports); assert.equal(result.live, true); assert.equal(armed, 0); return;
  }
  if (c.id === 'unprovable-old-process') status = 'unknown';
  if (c.id === 'deadline-before-boundary') { status = 'live'; elapsedMs = 599999; }
  if (['hung-link-deadline-failure', 'three-startup-hangs'].includes(c.id)) { status = 'live'; elapsedMs = 600000; }
  if (success) ready = { attemptId: 'A2', releaseId: 'R2', bootId: 'B1', processProof: proof, readyAt: 599999 };
  if (c.id === 'stale-ready-marker') ready = { attemptId: 'A1', releaseId: 'R2', bootId: 'B1', processProof: proof, readyAt: 100 };
  if (c.id === 'ready-wrong-runtime') ready = { attemptId: 'A2', releaseId: 'R1', bootId: 'B1', processProof: proof, readyAt: 100 };
  if (c.id === 'late-ready-cannot-erase-failure') {
    await mutate(home, n => n.starts.R2 = start(r2, 2, pending('A2', { state: 'failed' })));
    ready = { attemptId: 'A2', releaseId: 'R2', bootId: 'B1', processProof: proof, readyAt: 600001 };
  }
  if (c.id === 'same-release-new-manifest-seq') {
    await mutate(home, n => { n.rejected.R2 = { reason: 'three_failed_starts' }; n.starts.R2.consecutiveFailures = 3; });
    const before = await readInstallRecord({ home }); const result = await prepareLinkStart({ home }, ports);
    assert.equal(result.code, 'recovery_required'); assert.deepEqual((await readInstallRecord({ home })).value, before.value); return;
  }
  if (c.id === 'different-published-release') {
    const r3 = await runtime(home, 'R3', { client: true });
    await mutate(home, n => { n.rejected.R2 = { reason: 'three_failed_starts' }; });
    await fs.unlink(join(home, '.pdd/current')); await pointer(home, 'current', r3);
    assert.equal((await prepareLinkStart({ home }, ports)).runtime.releaseId, 'R3'); assert.ok((await readInstallRecord({ home })).value.rejected.R2); return;
  }
  if (c.id === 'rollback-recovery-after-flip') {
    await fs.unlink(join(home, '.pdd/current')); await pointer(home, 'current', r1);
    await mutate(home, n => { n.transaction = { id: 'T1', phase: 'rolling_back', from: r1, to: r2 }; n.reports = [{ id: 'startup-R2', type: 'release.block' }]; });
    const result = await reconcileStartup({ home }, ports); assert.equal(result.phase, 'rolled_back');
    assert.equal((await readInstallRecord({ home })).value.reports.length, 1); assert.equal(await fs.realpath(join(home, '.pdd/current')), r1.versionRoot); return;
  }
  if (c.id === 'success-breaks-consecutive-chain') {
    ready = { attemptId: 'A2', releaseId: 'R2', bootId: 'B1', processProof: proof, readyAt: 100 };
    await reconcileStartup({ home }, ports); ready = null;
    for (const id of ['A3', 'A4']) { await mutate(home, n => n.starts.R2.pending = pending(id)); await reconcileStartup({ home }, ports); }
    assert.equal((await readInstallRecord({ home })).value.starts.R2.consecutiveFailures, c.expected.consecutiveFailures); return;
  }
  if (['link-start-and-link-owned-check', 'failed-network-check'].includes(c.id)) {
    status = 'live';
    const before = (await readInstallRecord({ home })).value.starts.R2.consecutiveFailures;
    const result = await reconcileStartup({ home }, { ...ports, fetch: () => assert.fail('launcher must not check releases') });
    assert.equal(result.live, true); assert.equal((await readInstallRecord({ home })).value.starts.R2.consecutiveFailures, before); return;
  }
  const result = c.id === 'exec-failure-counts' ? await recordExecFailure({ home, attemptId: 'A2' }, ports) : await reconcileStartup({ home, attemptId: c.id === 'stale-deadline-pid-reused' ? 'A1' : undefined, deadline: true }, ports);
  const record = (await readInstallRecord({ home })).value;
  if (third) {
    assert.equal(record.starts.R2.consecutiveFailures, 3); assert.ok(record.rejected.R2); assert.equal(record.reports.filter(r => r.type === 'release.block').length, 1);
    if (c.id === 'no-valid-previous') assert.equal(result.code, 'recovery_required');
    else { assert.equal(result.code, null); assert.equal(await fs.realpath(join(home, '.pdd/current')), r1.versionRoot); assert.equal(await fs.realpath(join(home, '.pdd/previous')), r1.versionRoot); }
  } else if (success) { assert.equal(record.starts.R2.consecutiveFailures, 0); assert.equal(record.starts.R2.pending, null); }
  else if (c.id === 'unprovable-old-process') { assert.equal(result.code, c.expected.code); assert.equal(record.starts.R2.consecutiveFailures, failures); }
  else if (['deadline-before-boundary', 'stale-deadline-pid-reused'].includes(c.id)) { assert.equal(record.starts.R2.consecutiveFailures, failures); assert.equal(terminations, 0); }
  else assert.equal(record.starts.R2.consecutiveFailures, 2);
  if (c.id === 'hung-link-deadline-failure') assert.equal(terminations, 1);
});

test('Link ready requires its current proved process and beats a stale deadline callback', async t => {
  const home = await temporary(t), rt = await runtime(home, 'R2', { client: true }); await pointer(home, 'current', rt);
  await seed(home, { starts: { R2: start(rt, 2, pending('A2')) } });
  const ports = { selfProof: () => proof, now: () => ({ bootId: 'B1', elapsedMs: 599999 }) };
  assert.equal((await commitStartupReady({ home, attemptId: 'A2' }, ports)).code, null);
  const before = await readInstallRecord({ home });
  await reconcileStartup({ home, attemptId: 'A2', deadline: true }, { processState: () => 'live' });
  assert.deepEqual(await readInstallRecord({ home }), before);
});

test('a CLI-only current change cannot start a second Link while the retained Link is live', async t => {
  const home = await temporary(t), old = await runtime(home, 'R1', { client: true }), current = await runtime(home, 'R2', { client: true });
  await pointer(home, 'current', current); await seed(home, { starts: { R1: { ...start(old, 0, null), lastSuccess: 'old-success' } } });
  let armed = 0;
  const ports = { readReady: async () => ({ releaseId: 'R1', attemptId: 'old-success', processProof: proof }), processState: async () => 'live', armStartupDeadline: async () => { armed++; } };
  const result = await prepareLinkStart({ home }, ports); assert.equal(result.live, true); assert.equal(armed, 0);
  assert.equal(result.runtime.releaseId, 'R2');
});

test('a retained Link deadline still reconciles its exact attempt after a CLI-only flip', async t => {
  const home = await temporary(t), old = await runtime(home, 'R1', { client: true }), current = await runtime(home, 'R2', { client: true });
  await pointer(home, 'current', current); await seed(home, { starts: { R1: start(old, 0, pending('old-start')) } });
  let killed = 0;
  const result = await reconcileStartup({ home, attemptId: 'old-start', deadline: true }, { processState: () => 'live', now: () => ({ bootId: 'B1', elapsedMs: 600000 }), terminateProcess: async () => { killed++; }, readReady: () => null });
  assert.equal(result.code, null); assert.equal(killed, 1); assert.equal((await readInstallRecord({ home })).value.starts.R1.consecutiveFailures, 1);
  assert.equal(await fs.realpath(join(home, '.pdd/current')), current.versionRoot);
});

test('equal macOS service text retries failed activation and proves the loaded service', async t => {
  const home = await temporary(t); let loaded = false, bootstraps = 0;
  const ports = { platform: 'darwin', execFile: async (file, args) => {
    assert.equal(file, 'launchctl');
    if (args[0] === 'print') { if (!loaded) throw Error('not loaded'); return { stdout: 'loaded' }; }
    assert.equal(args[0], 'bootstrap'); bootstraps++; if (bootstraps === 1) throw Error('interrupted activation'); loaded = true; return {};
  } };
  const setup = () => withUpdateLock({ home }, lease => provisionRecoveryService({ home, runtime: {}, lease }, ports));
  assert.equal((await setup()).code, 'service_unavailable');
  const file = recoveryServiceFiles({ home, platform: 'darwin' })[0].path, before = await fs.stat(file);
  assert.equal((await setup()).code, null); assert.equal(bootstraps, 2); assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
  assert.equal((await setup()).code, null); assert.equal(bootstraps, 2);
});
