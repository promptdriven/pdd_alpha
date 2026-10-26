import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startUpdate, runUpdate, recoverUpdate } from '../../src/detached-updater.mjs';
import { readInstallRecord } from '../../src/install-record.mjs';
import { withUpdateLock, validUpdateLease } from '../../src/update-lock.mjs';
import { cases, temporary, runtime, pointer, put, mutate, proof, tarFixture } from './pkg-fixtures.mjs';

export async function updateFixture(t, options = {}) {
  const home = await temporary(t), r1 = await runtime(home, 'R1', { client: Boolean(options.client) }), r2 = await runtime(home, 'R2', { client: Boolean(options.client), nodeVersion: options.nodeChange ? '22.16.1' : '22.16.0' });
  await pointer(home, 'current', r1);
  const stage = join(home, '.pdd/update/staging/candidate'); await put(join(stage, 'checked.mjs'), 'synthetic verified package');
  const events = [], counters = { launches: 0, restarts: 0, releases: 0, selfTests: 0, compatibility: 0, authorizations: 0, underLock: 0 };
  const target = { releaseId: 'R2', manifestSeq: 12, artifacts: {}, runtime: r2, authorization: { operation: 'update', requestId: 'Q1', alphaDigest: r2.alphaDigest } };
  const ports = {
    home,
    withUpdateLock: (input, action, p) => withUpdateLock(input, async lease => { counters.underLock++; try { return await action(lease); } finally { counters.underLock--; } }, p),
    authorizeTarget: async () => { counters.authorizations++; return true; },
    launchDetached: async () => { counters.launches++; assert.equal(counters.underLock, 0); return { independent: true, processProof: { unit: 'synthetic-owned-updater', ...proof } }; },
    stageArtifacts: async () => { assert.equal(counters.underLock, 0); events.push('download'); return { alphaRoot: stage, temporaryNode: r2.node, temporaryBin: r2.bin, runtime: r2 }; },
    freeBytes: async () => 1073741824,
    selfTest: async (candidate, contract) => { counters.selfTests++; assert.equal(counters.underLock, 0); assert.equal(contract.readOnly, true); return true; },
    compareCredentialHelpers: async input => { assert.equal(input.sameSnapshot, true); assert.equal(input.fixedClock, true); return true; },
    listRetainedRuntimes: async () => ({ complete: true, runtimes: [r1] }),
    checkCompatibility: async () => { counters.compatibility++; return true; },
    acquireActivationBarrier: async () => ({ id: 'B1', held: true, drained: true, durable: true, release: async () => { counters.releases++; } }),
    recoverActivationBarrier: async () => ({ id: 'B1', held: true, drained: true, durable: true, release: async () => { counters.releases++; } }),
    publishArtifacts: async (staged, target, lease) => { assert.equal(validUpdateLease(lease, home), true); events.push('publish'); return r2; },
    runningLinkRuntime: async () => options.client ? r1 : null,
    restartLink: async () => { counters.restarts++; return { processProof: { ...proof, birth: 'successor' } }; }
  };
  return { home, r1, r2, target, ports, counters, events, start: () => startUpdate({ target, requestId: 'Q1' }, ports) };
}

for (const c of await cases('detached-updater')) test(c.id, async t => {
  const client = ['helper-mismatch', 'public-npm-client-no-token', 'cli-only-release', 'running-link-older-than-current', 'node-only-change', 'kill-after-current-flip', 'hung-link-uses-launcher-deadline'].includes(c.id);
  const f = await updateFixture(t, { client, nodeChange: c.id === 'node-only-change' });
  if (c.id === 'independent-linux-unit' || c.id === 'mac-ssh-disconnect') {
    const started = await f.start(); assert.equal(started.state, 'accepted'); assert.equal(f.counters.launches, 1);
    const job = (await readInstallRecord({ home: f.home })).value.staging[started.transactionId]; assert.equal(job.processProof.unit, 'synthetic-owned-updater'); return;
  }
  const request = await f.start(), id = request.transactionId; assert.equal(request.state, 'accepted');
  if (c.id === 'same-request') {
    const again = await f.start(); assert.equal(again.transactionId, id); assert.equal(f.counters.launches, 1); return;
  }
  if (c.id === 'detach-proof-uncertain') {
    await mutate(f.home, n => n.staging[id].processProof = null);
    const again = await f.start(); assert.equal(again.code, 'recovery_required'); assert.equal(f.counters.launches, 1); return;
  }
  if (c.id === 'stage-low-disk') f.ports.freeBytes = async () => c.given.freeBytesAfterDownload;
  if (c.id === 'helper-mismatch') f.ports.compareCredentialHelpers = async () => false;
  if (c.id === 'retained-old-run-incompatible') f.ports.checkCompatibility = async () => false;
  if (c.id === 'target-blocked-after-stage') {
    const normal = f.ports.authorizeTarget;
    f.ports.authorizeTarget = async () => { if (f.counters.selfTests) return { ok: false, code: 'target_blocked' }; return normal(); };
  }
  if (['new-action-during-drain', 'person-check-active', 'twenty-four-hour-boundary', 'join-after-twenty-four-hours'].includes(c.id)) {
    f.ports.now = () => 25 * 3600000;
    f.ports.acquireActivationBarrier = async (tx, policy) => {
      assert.equal(policy.drainRequired, true);
      if (c.id === 'join-after-twenty-four-hours') { assert.equal(policy.ignoreJoinsAndSignIns, true); return { id: 'B1', held: true, drained: true, durable: true, joinActive: true }; }
      if (c.id === 'person-check-active') return { id: 'B1', held: true, drained: true, durable: true, personCheckActive: true };
      return { id: 'B1', held: true, drained: false, durable: false };
    };
    // A checked checkpoint from the prior day is durable before retry.
    const first = await runUpdate({ transactionId: id }, { ...f.ports, acquireActivationBarrier: async () => null }); assert.equal(first.phase, 'checked');
    await mutate(f.home, n => n.staging[id].checkedAt = 0);
  }
  if (c.id === 'running-link-older-than-current') f.ports.runningLinkRuntime = async () => ({ ...f.r1, clientDigest: 'older-client' });
  if (c.id === 'downloads-outside-activation-lock') {
    const ready = Promise.withResolvers(), release = Promise.withResolvers();
    const owner = withUpdateLock({ home: f.home }, async () => { ready.resolve(); await release.promise; }); await ready.promise;
    const stage = f.ports.stageArtifacts;
    f.ports.stageArtifacts = async () => { const candidate = await stage(); release.resolve(); return candidate; };
    const r = await runUpdate({ transactionId: id }, f.ports); await owner; assert.equal(r.phase, 'ready'); return;
  }
  if (['kill-after-current-flip', 'unknown-pointer-state'].includes(c.id)) {
    await runUpdate({ transactionId: id }, { ...f.ports, acquireActivationBarrier: async () => null });
    await mutate(f.home, n => n.transaction = { id, phase: 'activating', from: f.r1, to: f.r2, barrierId: 'B1', restartRequired: client, restartIntent: client ? { attemptId: 'A9', processProof: null } : null });
    await fs.unlink(join(f.home, '.pdd/current'));
    const current = c.id === 'unknown-pointer-state' ? await runtime(f.home, 'R9') : f.r2;
    await pointer(f.home, 'current', current); await pointer(f.home, 'previous', f.r1);
    f.ports.proveLinkRestart = async () => ({ processProof: { ...proof, birth: 'successor' } });
    const recovered = await recoverUpdate({ home: f.home }, f.ports);
    if (c.id === 'unknown-pointer-state') assert.equal(recovered.code, 'recovery_required');
    else { assert.equal(recovered.phase, 'link_restarted'); assert.equal(f.counters.restarts, 0); assert.equal(await fs.realpath(join(f.home, '.pdd/previous')), f.r1.versionRoot); }
    return;
  }
  const r = await runUpdate({ transactionId: id }, f.ports);
  if (['stage-low-disk', 'helper-mismatch', 'retained-old-run-incompatible'].includes(c.id)) {
    assert.equal(r.code, c.expected.code ?? 'stage_failed'); assert.equal(await fs.realpath(join(f.home, '.pdd/current')), f.r1.versionRoot); assert.equal(f.counters.restarts, 0); return;
  }
  if (c.id === 'target-blocked-after-stage') { assert.equal(r.code, 'target_blocked'); assert.equal(await fs.realpath(join(f.home, '.pdd/current')), f.r1.versionRoot); return; }
  if (['new-action-during-drain', 'person-check-active', 'twenty-four-hour-boundary'].includes(c.id)) { assert.equal(r.phase, 'checked'); assert.equal(await fs.realpath(join(f.home, '.pdd/current')), f.r1.versionRoot); return; }
  if (['node-only-change', 'running-link-older-than-current'].includes(c.id)) { assert.equal(f.counters.restarts, 1); assert.equal(r.phase, 'link_restarted'); }
  else if (c.id === 'hung-link-uses-launcher-deadline') { assert.equal(r.phase, 'ready'); assert.equal(f.counters.restarts, 0); }
  else { assert.equal(r.phase, 'ready'); assert.equal(f.counters.restarts, 0); }
  assert.equal(await fs.realpath(join(f.home, '.pdd/current')), f.r2.versionRoot); assert.equal(await fs.realpath(join(f.home, '.pdd/previous')), f.r1.versionRoot);
});

test('missing authorization and failed detachment never run an updater inline', async t => {
  const f = await updateFixture(t);
  assert.equal((await startUpdate({ target: f.target, requestId: 'Q1' }, { home: f.home })).code, 'authorization_unavailable');
  f.ports.launchDetached = async () => ({ code: 'detach_failed' });
  assert.equal((await f.start()).code, 'detach_failed'); assert.deepEqual(f.events, []);
});

test('no duplicate restart after an uncertain service effect; durable ready releases the barrier', async t => {
  const f = await updateFixture(t, { client: true }); f.ports.runningLinkRuntime = async () => ({ ...f.r1, clientDigest: 'C0' });
  f.ports.restartLink = async () => { f.counters.restarts++; throw new Error('response lost'); };
  const request = await f.start();
  const first = await runUpdate({ transactionId: request.transactionId }, f.ports); assert.equal(first.code, 'recovery_required');
  const uncertain = await recoverUpdate({ home: f.home }, f.ports); assert.equal(uncertain.code, 'recovery_required'); assert.equal(f.counters.restarts, 1);
  f.ports.proveLinkRestart = async () => ({ processProof: { ...proof, birth: 'new' } });
  assert.equal((await recoverUpdate({ home: f.home }, f.ports)).phase, 'link_restarted');
  await mutate(f.home, n => n.starts.R2 = { runtime: f.r2, consecutiveFailures: 0, pending: null, lastSuccess: 'accepted-start' });
  assert.equal((await recoverUpdate({ home: f.home }, f.ports)).phase, 'ready'); assert.equal(f.counters.restarts, 1); assert.equal(f.counters.releases, 1);
});

test('default artifact pipeline verifies, stages and publishes complete immutable roots before current', async t => {
  const home = await temporary(t), before = await runtime(home); await pointer(home, 'current', before);
  const alpha = tarFixture({ 'package/package.json': '{"type":"module","version":"1.0.2"}', 'package/bin/pdd.mjs': '// candidate', 'package/src/pdd-cli.mjs': '// self-test stand-in' });
  const node = tarFixture({ 'node-v22.16.1-linux-x64/bin/node': '#!/bin/sh\nexit 0\n' });
  const descriptor = (kind, bytes) => ({ url: `https://release.invalid/${kind}`, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, authority: { keyId: 'synthetic-key' } });
  const alphaArtifact = descriptor('alpha', alpha), nodeArtifact = { ...descriptor('node', node), version: '22.16.1', platform: 'linux', arch: 'x64' };
  const versionRoot = join(home, '.pdd/versions/R2'), rt = { v: 1, releaseId: 'R2', versionRoot, node: join(home, '.pdd/tools/node/22.16.1/bin/node'), bin: join(versionRoot, 'bin/pdd.mjs'), pddVersion: '1.0.2', alphaDigest: alphaArtifact.integrity, clientDigest: null, nodeVersion: '22.16.1', credentialHelper: null };
  const target = { releaseId: 'R2', runtime: rt, manifestSeq: 1, artifacts: { alpha: alphaArtifact, node: nodeArtifact }, authorization: { fixture: true } };
  let publicationSeen = false;
  const ports = { home, authorizeTarget: async () => true, launchDetached: async () => ({ independent: true, processProof: proof }), downloadArtifact: async a => a.url.endsWith('/alpha') ? alpha : node, verifyArtifact: async () => true, verifyProvenance: async () => true, probeNode: async () => ({ version: '22.16.1', platform: 'linux', arch: 'x64' }), freeBytes: async () => 1073741824,
    selfTest: async candidate => { assert.ok(candidate.temporaryNode.includes('/update/staging/')); assert.ok(candidate.temporaryBin.includes('/update/staging/')); assert.equal(await fs.realpath(join(home, '.pdd/current')), before.versionRoot); return true; },
    listRetainedRuntimes: async () => ({ complete: true, runtimes: [before] }), checkCompatibility: async () => true,
    acquireActivationBarrier: async () => ({ id: 'B1', held: true, durable: true, drained: true, release: async () => { publicationSeen = true; } }) };
  const request = await startUpdate({ target, requestId: 'actual-artifacts' }, ports);
  const applied = await runUpdate({ transactionId: request.transactionId }, ports);
  assert.equal(applied.phase, 'ready'); assert.equal(applied.code, null); assert.equal(publicationSeen, true);
  assert.equal(await fs.realpath(join(home, '.pdd/current')), versionRoot); assert.equal(await fs.realpath(join(home, '.pdd/previous')), before.versionRoot);
  assert.deepEqual(JSON.parse(await fs.readFile(join(versionRoot, 'runtime.json'))), rt); assert.equal(await fs.readFile(rt.bin, 'utf8'), '// candidate');
});

test('a local rejection survives new request ids even when a caller still authorizes the same bytes', async t => {
  const f = await updateFixture(t), request = await f.start();
  await mutate(f.home, n => n.rejected.R2 = { alphaDigest: f.r2.alphaDigest, clientDigest: null, reason: 'three_failed_starts' });
  assert.equal((await runUpdate({ transactionId: request.transactionId }, f.ports)).code, 'target_rejected');
  assert.equal((await startUpdate({ target: f.target, requestId: 'new-id' }, f.ports)).code, 'target_rejected'); assert.deepEqual(f.events, []);
});
