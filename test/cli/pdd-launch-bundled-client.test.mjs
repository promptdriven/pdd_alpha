import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { prepareLinkStart, runLauncherCommand } from '../../src/pdd-launch.mjs';
import { resolveRuntime } from '../../src/versions.mjs';
import { directoryDigest } from '../../src/owned-node.mjs';
import { readInstallRecord } from '../../src/install-record.mjs';
import { withUpdateLock, validUpdateLease } from '../../src/update-lock.mjs';
import { completeBootstrap } from '../../launcher/bootstrap-entry.mjs';
import { temporary, runtime, pointer, seed, mutate, put, repo, proof, start, pending } from './pkg-fixtures.mjs';

async function payload(root) {
  await put(join(root, 'package.json'), '{"type":"module"}\n');
  await put(join(root, 'src/phone/link/main.mjs'), 'export async function runLink() { return 0; }\n');
  await put(join(root, 'resource.txt'), 'synthetic packaged dependency\n');
}
async function fixture(t) {
  const home = await temporary(t), rt = await runtime(home), root = join(rt.versionRoot, 'client');
  await pointer(home, 'current', rt);
  await payload(root);
  const binding = { path: root, algorithm: 'pdd-directory-sha256-v1', digest: await directoryDigest(root) };
  assert.equal((await seed(home, { installedClients: { R1: binding }, unrelated: { keep: true } })).code, null);
  return { home, rt, root };
}
function launchPorts(home) {
  const calls = [];
  return { home, calls, selfProof: () => proof, processState: () => 'dead',
    now: () => ({ bootId: proof.bootId, elapsedMs: 1000 }),
    clearReady: () => { calls.push('clear'); },
    armStartupDeadline: attempt => { calls.push('deadline'); return { id: 'offline-timer', bootId: attempt.bootId, deadlineAt: attempt.deadlineAt }; }
  };
}
async function refusedWithoutAttempt(f, ports = launchPorts(f.home), code = 'client_not_installed') {
  const record = join(f.home, '.pdd/install/record.json'), before = await fs.readFile(record);
  await put(join(f.home, '.pdd/link/ready'), 'old ready evidence');
  assert.equal((await prepareLinkStart({ home: f.home }, ports)).code, code);
  assert.deepEqual(await fs.readFile(record), before);
  assert.equal(await fs.readFile(join(f.home, '.pdd/link/ready'), 'utf8'), 'old ready evidence');
  assert.deepEqual(ports.calls, []);
}

test('bundled client without Accounts helper enters the ordinary original attempt and exec route', async t => {
  const f = await fixture(t), ports = launchPorts(f.home), before = await resolveRuntime({ home: f.home });
  let invoked;
  const result = await runLauncherCommand(['link'], { ...ports, exec: (file, args, env) => { invoked = { file, args, env }; return { code: null }; } });
  assert.equal(result.code, null);
  assert.deepEqual(ports.calls, ['clear', 'deadline']);
  const record = (await readInstallRecord({ home: f.home })).value, attempt = record.starts.R1.pending;
  assert.match(attempt.attemptId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(attempt.processProof, proof);
  assert.equal(attempt.startedAt, 1000); assert.equal(attempt.deadlineAt, 601000);
  assert.equal(attempt.deadlineRegistration.id, 'offline-timer');
  assert.equal(invoked.file, f.rt.node); assert.equal(invoked.args[2], f.rt.versionRoot);
  assert.equal(invoked.env.PDD_START_ATTEMPT, attempt.attemptId);
  assert.deepEqual(record.unrelated, { keep: true });
  assert.deepEqual(await resolveRuntime({ home: f.home }), before);
  assert.equal(before.clientDigest, null); assert.equal(before.credentialHelper, null);
});

const changes = {
  'absent provenance': f => mutate(f.home, n => { n.installedClients.R1 = null; }),
  'another release only': f => mutate(f.home, n => { n.installedClients = { R2: n.installedClients.R1, R1: null }; }),
  'wrong retained path': f => mutate(f.home, n => { n.installedClients.R1.path = join(f.home, '.pdd/current/client'); }),
  'wrong algorithm': f => mutate(f.home, n => { n.installedClients.R1.algorithm = 'sha256'; }),
  'malformed digest': f => mutate(f.home, n => { n.installedClients.R1.digest = 'not-a-digest'; }),
  'changed dependency bytes': f => fs.appendFile(join(f.root, 'resource.txt'), 'changed'),
  'changed dependency mode': f => fs.chmod(join(f.root, 'resource.txt'), 0o700),
  'missing Main': f => fs.unlink(join(f.root, 'src/phone/link/main.mjs')),
  'aliased client': async f => { await fs.rename(f.root, f.root + '-real'); await fs.symlink(f.root + '-real', f.root); },
  'aliased Main': async f => { const path = join(f.root, 'src/phone/link/main.mjs'); await fs.rename(path, path + '.real'); await fs.symlink('main.mjs.real', path); },
  'aliased Main parent': async f => { const path = join(f.root, 'src/phone/link'); await fs.rename(path, path + '-real'); await fs.symlink('link-real', path); },
  'aliased package': async f => { const path = join(f.root, 'package.json'); await fs.rename(path, path + '.real'); await fs.symlink('package.json.real', path); },
  'non-ESM package': f => fs.writeFile(join(f.root, 'package.json'), '{"type":"commonjs"}'),
  'missing package': f => fs.unlink(join(f.root, 'package.json')),
};
for (const [name, change] of Object.entries(changes)) test(`bundled admission refuses ${name} before attempt, ready removal or deadline`, async t => {
  const f = await fixture(t);
  await change(f);
  // A matching digest must not excuse an invalid physical entry or ESM boundary.
  if (name.startsWith('aliased ') || name === 'non-ESM package' || name === 'missing Main' || name === 'missing package') {
    const digest = await directoryDigest(f.root);
    await mutate(f.home, n => { n.installedClients.R1.digest = digest; });
  }
  await refusedWithoutAttempt(f);
});

test('bundled admission reads and hashes the payload inside the real install lease', async t => {
  const f = await fixture(t), ports = launchPorts(f.home);
  await refusedWithoutAttempt(f, { ...ports, withUpdateLock: (spec, action, options) => withUpdateLock(spec, async lease => {
    assert.equal(validUpdateLease(lease, f.home), true);
    await fs.appendFile(join(f.root, 'resource.txt'), 'changed after lock acquisition');
    return action(lease);
  }, options) });
});

test('bundled admission preserves record and enclosing runtime refusals', async t => {
  const f = await fixture(t);
  await fs.writeFile(join(f.home, '.pdd/install/record.json'), '{damaged');
  await refusedWithoutAttempt(f, launchPorts(f.home), 'record_damaged');
  await fs.unlink(join(f.home, '.pdd/install/record.json'));
  await seed(f.home);
  await fs.writeFile(join(f.rt.versionRoot, 'runtime.json'), JSON.stringify({ ...f.rt, credentialHelper: '/wrong/helper' }));
  await refusedWithoutAttempt(f, launchPorts(f.home), 'runtime_unavailable');
});

test('bundled admission never repeats a live attempt or replaces unknown process proof', async t => {
  const f = await fixture(t);
  await mutate(f.home, n => { n.starts.R1 = start(f.rt, 0, pending('original')); });
  await fs.rm(f.root, { recursive: true });
  const before = await readInstallRecord({ home: f.home });
  for (const status of ['live', 'unknown']) {
    const ports = launchPorts(f.home);
    const result = await prepareLinkStart({ home: f.home }, { ...ports, processState: () => status });
    if (status === 'live') assert.equal(result.live, true);
    else assert.equal(result.code, 'recovery_required');
    assert.deepEqual(await readInstallRecord({ home: f.home }), before);
    assert.deepEqual(ports.calls, []);
  }
});

test('bundled payload does not bypass deadline or exec failures', async t => {
  const f = await fixture(t), ports = launchPorts(f.home);
  const result = await prepareLinkStart({ home: f.home }, { ...ports, armStartupDeadline: () => ({ code: 'startup_deadline_unavailable' }) });
  assert.equal(result.code, 'startup_deadline_unavailable');
  let record = (await readInstallRecord({ home: f.home })).value;
  assert.equal(record.starts.R1.pending.deadlineRegistration, null);
  assert.equal(record.starts.R1.consecutiveFailures, 0);
  const other = await fixture(t);
  assert.equal((await runLauncherCommand(['link'], { ...launchPorts(other.home), exec: () => { throw Error('exec failed'); } })).code, 'runtime_unavailable');
  record = (await readInstallRecord({ home: other.home })).value;
  assert.equal(record.starts.R1.pending.state, 'failed');
  assert.equal(record.starts.R1.consecutiveFailures, 1);
});

test('legacy archive and helper admission remains independent of bundled provenance', async t => {
  const home = await temporary(t), rt = await runtime(home, 'legacy', { client: true });
  await pointer(home, 'current', rt); await seed(home);
  assert.equal((await prepareLinkStart({ home }, launchPorts(home))).code, null);
  await fs.unlink(rt.credentialHelper);
  await assert.rejects(resolveRuntime({ home }), { code: 'runtime_unavailable' });
});

test('signed D10 bootstrap provenance admits helper-absent Link through installed support', async t => {
  const home = await temporary(t), stage = join(home, '.pdd/update/staging/bootstrap-bundled');
  await fs.mkdir(join(stage, 'node/bin'), { recursive: true });
  await fs.copyFile(process.execPath, join(stage, 'node/bin/node'));
  for (const dir of ['src', 'launcher']) await fs.cp(join(repo, dir), join(stage, 'alpha', dir), { recursive: true });
  await put(join(stage, 'alpha/bin/pdd.mjs'), '// synthetic public entry\n');
  await put(join(stage, 'alpha/package.json'), '{"type":"module","version":"1.0.0"}');
  await payload(join(stage, 'alpha/client'));
  // Synthetic already-extracted artifact edge, real signature verification,
  // client hashing, locked record, publication, support copy and launch admission.
  const asset = async name => {
    const bytes = Buffer.from('synthetic staged ' + name);
    await fs.writeFile(join(stage, name + '.tar.gz'), bytes);
    return { sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'), provenance: 'offline fixture' };
  };
  const descriptor = { releaseId: 'signed', pddVersion: '1.0.0', environment: 'staging', keyId: 'offline', alpha: await asset('alpha'),
    nodes: { [`${process.platform}-${process.arch}`]: { ...await asset('node'), version: process.versions.node } },
    client: { path: 'client', algorithm: 'pdd-directory-sha256-v1', digest: await directoryDigest(join(stage, 'alpha/client')) } };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519'), bytes = Buffer.from(JSON.stringify(descriptor));
  const root = { schema: 'pdd/staging-release-root/v1', purpose: 'u4-user-release-root', environment: 'staging', keyId: 'offline', algorithm: 'Ed25519',
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), publicKeyDerSha256: createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex') };
  await put(join(stage, 'release.json'), bytes);
  await put(join(stage, 'alpha/trust/descriptor.json'), bytes);
  await put(join(stage, 'alpha/trust/descriptor.sig'), sign(null, bytes, privateKey).toString('base64url') + '\n');
  await put(join(stage, 'alpha/trust/release-root.json'), JSON.stringify(root));
  const installed = await completeBootstrap({ home, stage }, { selfTest: async () => true, activateRecoveryService: async () => {} });
  assert.equal(installed.runtime.clientDigest, null); assert.equal(installed.runtime.credentialHelper, null);
  const saved = (await readInstallRecord({ home })).value.installedClients.signed;
  assert.deepEqual(saved, { ...descriptor.client, path: join(installed.runtime.versionRoot, 'client') });
  const support = await import(pathToFileURL(join(home, '.pdd/launcher/support/src/pdd-launch.mjs')));
  let invoked;
  assert.equal((await support.runLauncherCommand(['link'], { ...launchPorts(home), exec: (file, args, env) => { invoked = { file, args, env }; return { code: null }; } })).code, null);
  assert.equal(invoked.file, installed.runtime.node);
  assert.equal(invoked.args[2], installed.runtime.versionRoot);
  assert.ok(invoked.args[1].includes('/launcher/support-'));
  assert.equal(invoked.env.PDD_START_ATTEMPT, (await readInstallRecord({ home })).value.starts.signed.pending.attemptId);
});
