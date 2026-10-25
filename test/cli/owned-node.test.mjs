import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installLauncherSupport } from '../../src/pdd-launch.mjs';
import { collectVersions } from '../../src/versions.mjs';
import { stageOwnedNode, ensureOwnedNode, extractVerifiedTar } from '../../src/owned-node.mjs';
import { withUpdateLock } from '../../src/update-lock.mjs';
import { cases, temporary, put, runtime, pointer, repo } from './pkg-fixtures.mjs';

const execute = promisify(execFile);
async function installSupport(home, rt) {
  for (const path of ['src', 'launcher']) await fs.cp(join(repo, path), join(rt.versionRoot, path), { recursive: true });
  return withUpdateLock({ home }, lease => installLauncherSupport({ home, runtime: rt, lease }));
}
const bytes = Buffer.from('synthetic verified node archive');
const artifact = { version: '22.16.0', platform: 'linux', arch: 'x64', url: 'https://release.invalid/node.tar.gz', integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}`, authority: { keyId: 'synthetic-release' } };
async function stage(home, changes = {}, overrides = {}) {
  return stageOwnedNode({ home, artifact: { ...artifact, ...changes }, platform: 'linux', arch: 'x64', transactionId: 'T1' }, {
    downloadArtifact: async () => bytes,
    verifyArtifact: async () => true,
    extractArchive: async (data, path) => { await put(join(path, 'bin/node'), '#!/bin/sh\nexit 0\n', 0o755); },
    probeNode: async () => ({ version: '22.16.0', platform: 'linux', arch: 'x64' }),
    ...overrides
  });
}
for (const c of await cases('owned-node')) test(c.id, async t => {
  const home = await temporary(t);
  if (c.id === 'unsupported-architecture') {
    const r = await stageOwnedNode({ home, artifact, platform: 'darwin', arch: 'unknown', transactionId: 'T1' }); assert.equal(r.code, c.expected.code); return;
  }
  if (c.id === 'archive-escape') {
    // Construct one syntactically correct tar header whose name escapes extraction.
    const tar = Buffer.alloc(1024); tar.write('../../outside/node'); tar.write('0000755\0', 100); tar.write('00000000000\0', 124); tar.fill(32, 148, 156); tar.write('0', 156);
    const sum = tar.subarray(0, 512).reduce((a, b) => a + b, 0); tar.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    await assert.rejects(extractVerifiedTar(tar, join(home, 'stage'))); await assert.rejects(fs.lstat(join(home, 'outside')), { code: 'ENOENT' }); return;
  }
  if (c.id === 'engine-floor') { assert.equal((await stage(home, { version: '20.0.0' })).code, 'runtime_verification_failed'); return; }
  if (c.id === 'tampered-artifact') {
    let runs = 0; const r = await stage(home, { integrity: 'sha256-bad' }, { probeNode: () => runs++ }); assert.equal(r.code, c.expected.code); assert.equal(runs, 0); return;
  }
  if (c.id === 'download-interrupted') { const r = await stage(home, {}, { downloadArtifact: () => { throw new Error('interrupted'); } }); assert.equal(r.code, c.expected.code); return; }
  if (c.id === 'node-stage-does-not-hold-global-lock') {
    await withUpdateLock({ home }, async () => { const r = await stage(home); assert.ok(r.stagedNode.includes('/update/staging/T1/')); }); return;
  }
  if (c.id === 'retained-runtime-node') {
    const old = await runtime(home, 'R1', { nodeVersion: '22.16.0' }), previous = await runtime(home, 'R2', { nodeVersion: '22.16.1' }), current = await runtime(home, 'R3', { nodeVersion: '22.16.2' });
    await pointer(home, 'current', current); await pointer(home, 'previous', previous);
    const result = await collectVersions({ home, references: { complete: true, references: [old] } });
    assert.equal(result.code, null); assert.deepEqual(result.removed, []);
    for (const rt of [old, previous, current]) await fs.access(rt.node, 1);
    return;
  }
  if (['system-node-removed', 'candidate-node-cannot-exec'].includes(c.id)) {
    const rt = await runtime(home); await pointer(home, 'current', rt);
    assert.equal((await installSupport(home, rt)).code, null);
    const launcher = join(home, '.pdd/launcher/pdd-launch'), env = { ...process.env, HOME: home, PATH: '' };
    if (c.id === 'system-node-removed') {
      const result = await execute(launcher, ['cli', 'literal argument'], { env });
      assert.equal(JSON.parse(result.stdout).node, rt.node); assert.deepEqual(JSON.parse(result.stdout).argv, ['literal argument']);
    } else {
      const candidate = await runtime(home, 'R2', { nodeVersion: '22.16.1' });
      await fs.unlink(candidate.node); await put(candidate.node, 'unexecutable candidate', 0o600);
      await fs.unlink(join(home, '.pdd/current')); await pointer(home, 'current', candidate);
      await assert.rejects(execute(launcher, ['recover'], { env }), e => e.code === 1 && e.stderr.includes('runtime_unavailable'));
      assert.equal(await fs.realpath(join(home, '.pdd/launcher/support/node')), rt.node);
      assert.equal((await execute(rt.node, ['--version'], { env })).stdout.trim(), 'v' + process.versions.node);
    }
    return;
  }
  const staged = await stage(home); assert.ok(staged.stagedNode);
  if (c.id === 'existing-runtime-conflict') { await put(join(home, '.pdd/tools/node/22.16.0/bin/node'), 'conflicting bytes'); }
  let published = await withUpdateLock({ home }, lease => ensureOwnedNode({ home, staged, lease }));
  if (c.id === 'existing-runtime-conflict') { assert.equal(published.code, 'runtime_verification_failed'); assert.equal(await fs.readFile(join(home, '.pdd/tools/node/22.16.0/bin/node'), 'utf8'), 'conflicting bytes'); return; }
  assert.equal(published.node, join(home, '.pdd/tools/node/22.16.0/bin/node')); assert.equal(published.changed, true);
  if (c.id === 'reuse-verified-runtime') {
    const inode = (await fs.stat(published.node)).ino, other = await stage(home);
    published = await withUpdateLock({ home }, lease => ensureOwnedNode({ home, staged: other, lease }));
    assert.equal(published.changed, c.expected.changed); assert.equal((await fs.stat(published.node)).ino, inode);
  }
  assert.equal((await ensureOwnedNode({ home, staged, lease: {} })).code, 'lock_unavailable');
});

test('tampering with staged bytes before publication fails without touching the owned runtime', async t => {
  const home = await temporary(t), staged = await stage(home); await fs.appendFile(staged.stagedNode, 'changed');
  const result = await withUpdateLock({ home }, lease => ensureOwnedNode({ home, staged, lease }));
  assert.equal(result.code, 'runtime_verification_failed'); await assert.rejects(fs.stat(join(home, '.pdd/tools/node/22.16.0')), { code: 'ENOENT' });
});

test('archive symlink chains cannot conceal an escape through parent traversal', async t => {
  const home = await temporary(t), destination = join(home, 'stage'), blocks = [];
  for (const [name, type, link] of [['package/dir/', '5', ''], ['package/dir2/', '5', ''], ['package/dir/a', '2', '../dir2'], ['package/escape', '2', 'dir/a/../../outside']]) {
    const header = Buffer.alloc(512); header.write(name); header.write('0000755\0', 100); header.write('00000000000\0', 124); header.fill(32, 148, 156); header.write(type, 156); header.write(link, 157);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148); blocks.push(header);
  }
  await assert.rejects(extractVerifiedTar(Buffer.concat([...blocks, Buffer.alloc(1024)]), destination), /link escape/);
  await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(join(home, 'outside')), { code: 'ENOENT' });
});
