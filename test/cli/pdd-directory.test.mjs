import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { withUpdateLock } from '../../src/update-lock.mjs';
import { durableJson } from '../../src/install-record.mjs';
import { temporary } from './pkg-fixtures.mjs';
import { ensurePrivateDirectory, repairPrivateTree } from '../../src/pdd-directory.mjs';
import { directoryDigest } from '../../src/owned-node.mjs';
import { provisionRecoveryService } from '../../src/pdd-launch.mjs';

test('setup lock repairs an existing group-writable PDD home without replacing lock or data', async t => {
  const home = await temporary(t), root = join(home, '.pdd'), path = join(root, 'update.lock');
  await fs.mkdir(root); await fs.chmod(root, 0o775);
  await fs.writeFile(path, 'retained lock', { mode: 0o600 });
  await fs.writeFile(join(root, 'vault'), 'retained private bytes', { mode: 0o600 });
  const before = await fs.stat(path), homeMode = (await fs.stat(home)).mode;
  assert.equal(await withUpdateLock({ home }, async () => 'owned'), 'owned');
  assert.equal((await fs.stat(root)).mode & 0o7777, 0o700);
  assert.equal((await fs.stat(path)).ino, before.ino);
  assert.equal(await fs.readFile(join(root, 'vault'), 'utf8'), 'retained private bytes');
  assert.equal((await fs.stat(join(root, 'vault'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(home)).mode, homeMode);
});

test('durable setup records repair only mutable roots and preserve existing deeper directory modes', async t => {
  const home = await temporary(t), root = join(home, '.pdd');
  const dirs = [root, join(root, 'install'), join(root, 'install', 'nested')];
  await fs.mkdir(dirs.at(-1), { recursive: true });
  for (const dir of dirs) await fs.chmod(dir, 0o775);
  await fs.writeFile(join(root, 'keys'), 'retained-key', { mode: 0o640 });
  await durableJson(join(dirs.at(-1), 'record.json'), { future: { retained: true } });
  for (const dir of dirs.slice(0, 2)) assert.equal((await fs.stat(dir)).mode & 0o7777, 0o700, dir);
  assert.equal((await fs.stat(dirs[2])).mode & 0o7777, 0o775);
  assert.deepEqual(JSON.parse(await fs.readFile(join(dirs.at(-1), 'record.json'))), { future: { retained: true } });
  assert.equal(await fs.readFile(join(root, 'keys'), 'utf8'), 'retained-key');
  assert.equal((await fs.stat(join(root, 'keys'))).mode & 0o777, 0o640);
});

test('setup directory repair never follows an aliased PDD root or record parent', async t => {
  const home = await temporary(t), outside = join(home, 'outside');
  await fs.mkdir(outside); await fs.chmod(outside, 0o775);
  await fs.symlink(outside, join(home, '.pdd'));
  let calls = 0;
  assert.equal((await withUpdateLock({ home }, () => calls++)).code, 'lock_unavailable');
  assert.equal(calls, 0); assert.equal((await fs.stat(outside)).mode & 0o777, 0o775);
  await fs.unlink(join(home, '.pdd')); await fs.mkdir(join(home, '.pdd'));
  await fs.symlink(outside, join(home, '.pdd/install'));
  await assert.rejects(durableJson(join(home, '.pdd/install/record.json'), {}));
  assert.equal((await fs.stat(outside)).mode & 0o777, 0o775);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('private tree repair covers nested state without touching symlink targets or executable file modes', async t => {
  const home = await temporary(t), root = join(home, '.pdd'), outside = join(home, 'outside');
  const dirs = [root, join(root, 'logs'), join(root, 'runs'), join(root, 'runs/R1')];
  for (const dir of dirs) { await fs.mkdir(dir, { recursive: true }); await fs.chmod(dir, 0o775); }
  await fs.mkdir(outside); await fs.chmod(outside, 0o775);
  await fs.symlink(outside, join(root, 'external'));
  await fs.writeFile(join(root, 'program'), 'unchanged', { mode: 0o755 });
  await repairPrivateTree(root);
  for (const dir of dirs) assert.equal((await fs.stat(dir)).mode & 0o7777, 0o700);
  assert.equal((await fs.stat(outside)).mode & 0o7777, 0o775);
  assert.equal((await fs.lstat(join(root, 'external'))).isSymbolicLink(), true);
  assert.equal((await fs.stat(join(root, 'program'))).mode & 0o7777, 0o755);
  assert.equal(await fs.readFile(join(root, 'program'), 'utf8'), 'unchanged');
});

test('private directory repair rejects a different owner and preserves equal private directories without chmod', async t => {
  const home = await temporary(t), root = join(home, '.pdd');
  await fs.mkdir(root, { mode: 0o700 });
  let writes = 0, opens = 0;
  const io = { ...fs, open: async (...args) => {
    opens++; const handle = await fs.open(...args);
    return { stat: () => handle.stat(), close: () => handle.close(), chmod: mode => { writes++; return handle.chmod(mode); } };
  } };
  const unchanged = await fs.stat(root, { bigint: true });
  await ensurePrivateDirectory(root, io); assert.equal(opens, 1); assert.equal(writes, 0);
  const after = await fs.stat(root, { bigint: true });
  assert.equal(after.ino, unchanged.ino); assert.equal(after.ctimeNs, unchanged.ctimeNs);
  opens = 0;
  await assert.rejects(ensurePrivateDirectory(root, { ...io, lstat: async path => {
    const stat = await fs.lstat(path); Object.defineProperty(stat, 'uid', { value: process.geteuid() + 1 }); return stat;
  } }), /unsafe directory/);
  assert.equal(opens, 0); assert.equal(writes, 0);
});

test('private directory repair refuses a final symlink substituted after lstat without chmodding its target', async t => {
  const home = await temporary(t), root = join(home, '.pdd'), outside = join(home, 'outside');
  await fs.mkdir(root); await fs.mkdir(outside); await fs.chmod(outside, 0o775);
  const io = { ...fs, open: async (...args) => {
    await fs.rmdir(root); await fs.symlink(outside, root); return fs.open(...args);
  } };
  await assert.rejects(ensurePrivateDirectory(root, io));
  assert.equal((await fs.stat(outside)).mode & 0o7777, 0o775);
});

test('private directory creation supports a missing HOME while preserving existing outer modes', async t => {
  const outer = await temporary(t), home = join(outer, 'new-home');
  await fs.chmod(outer, 0o750);
  await withUpdateLock({ home }, async () => durableJson(join(home, '.pdd/install/record.json'), { kept: true }));
  assert.equal((await fs.stat(outer)).mode & 0o7777, 0o750);
  assert.equal((await fs.stat(join(home, '.pdd/install'))).mode & 0o7777, 0o700);
  assert.deepEqual(JSON.parse(await fs.readFile(join(home, '.pdd/install/record.json'))), { kept: true });
});

test('setup preserves shared service-directory modes while installing only its own service file', async t => {
  const home = await temporary(t), shared = join(home, '.config/systemd/user');
  await fs.mkdir(shared, { recursive: true }); await fs.chmod(shared, 0o750);
  await fs.writeFile(join(shared, 'other.service'), 'retained unrelated service');
  let activations = 0;
  const result = await withUpdateLock({ home }, lease => provisionRecoveryService({ home, runtime: {}, lease }, {
    platform: 'linux', activateRecoveryService: async () => { activations++; }
  }));
  assert.equal(result.code, null); assert.equal(activations, 1);
  assert.equal((await fs.stat(shared)).mode & 0o7777, 0o750);
  assert.equal(await fs.readFile(join(shared, 'other.service'), 'utf8'), 'retained unrelated service');
});


test('setup repairs only direct mutable PDD children while runtime trees and integrity receipts remain exact', async t => {
  const home = await temporary(t), root = join(home, '.pdd');
  const mutable = ['logs', 'runs', 'fleet', 'accounts', 'claims', 'install', 'link'];
  for (const name of mutable) {
    const directory = join(root, name);
    await fs.mkdir(join(directory, 'nested'), { recursive: true });
    await fs.chmod(directory, 0o775); await fs.chmod(join(directory, 'nested'), 0o750);
    await fs.writeFile(join(directory, 'nested', 'data'), 'retained ' + name, { mode: 0o640 });
  }
  const runtimes = [join(root, 'versions/R1'), join(root, 'tools/node/22.16.0')];
  const receipts = [];
  for (const runtime of runtimes) {
    await fs.mkdir(join(runtime, 'bin'), { recursive: true });
    await fs.chmod(runtime, 0o775); await fs.chmod(join(runtime, 'bin'), 0o755);
    await fs.writeFile(join(runtime, 'bin/program'), 'immutable program', { mode: 0o755 });
    const bytes = JSON.stringify({ treeDigest: await directoryDigest(runtime), artifactIdentity: 'retained-artifact', future: { retained: true } });
    const marker = runtime.includes('/versions/') ? '.pdd-release.json' : '.pdd-node.json';
    await fs.writeFile(join(runtime, marker), bytes, { mode: 0o640 }); receipts.push({ runtime, marker, bytes });
  }
  await fs.symlink(runtimes[0], join(root, 'current')); await fs.chmod(root, 0o775);
  let calls = 0;
  assert.equal(await withUpdateLock({ home }, () => ++calls), 1);
  assert.equal((await fs.stat(root)).mode & 0o7777, 0o700);
  for (const name of mutable) {
    assert.equal((await fs.stat(join(root, name))).mode & 0o7777, 0o700);
    assert.equal((await fs.stat(join(root, name, 'nested'))).mode & 0o7777, 0o750);
    assert.equal(await fs.readFile(join(root, name, 'nested/data'), 'utf8'), 'retained ' + name);
    assert.equal((await fs.stat(join(root, name, 'nested/data'))).mode & 0o7777, 0o640);
  }
  for (const { runtime, marker, bytes } of receipts) {
    assert.equal((await fs.stat(runtime)).mode & 0o7777, 0o775);
    assert.equal((await fs.stat(join(runtime, 'bin'))).mode & 0o7777, 0o755);
    assert.equal((await fs.stat(join(runtime, marker))).mode & 0o7777, 0o640);
    assert.equal(await fs.readFile(join(runtime, marker), 'utf8'), bytes);
    assert.equal(await directoryDigest(runtime), JSON.parse(bytes).treeDigest);
  }
  assert.equal(await fs.readlink(join(root, 'current')), runtimes[0]);
});

for (const variant of ['existing-child-symlink', 'absent-child-symlink', 'existing-child-directory']) {
  test(`directory authority refuses ancestor replacement before target access: ${variant}`, async t => {
    const home = await temporary(t), root = join(home, '.pdd'), saved = join(home, 'saved-pdd');
    const outside = join(home, 'outside'), target = join(root, 'install');
    const absent = variant.startsWith('absent'), replacementDirectory = variant.endsWith('-directory');
    await fs.mkdir(root, { mode: 0o700 }); await fs.mkdir(outside, { mode: 0o700 });
    if (!absent) {
      await fs.mkdir(join(root, 'install')); await fs.mkdir(join(outside, 'install'));
      await fs.chmod(join(outside, 'install'), 0o775);
      await fs.writeFile(join(outside, 'install/kept'), 'outside retained bytes', { mode: 0o640 });
    }
    let substituted = false;
    const replace = async path => {
      if (path !== target || substituted) return;
      substituted = true; await fs.rename(root, saved);
      if (replacementDirectory) await fs.rename(outside, root);
      else await fs.symlink(outside, root);
    };
    // Substitute immediately before the first child path access. The same case
    // exercises both implementations that mkdir first and those that stat first.
    const io = { ...fs,
      mkdir: async (path, ...args) => { await replace(path); return fs.mkdir(path, ...args); },
      lstat: async (path, ...args) => { await replace(path); return fs.lstat(path, ...args); }
    };
    await assert.rejects(ensurePrivateDirectory(target, io));
    assert.equal(substituted, true);
    const retained = replacementDirectory ? root : outside;
    if (absent) await assert.rejects(fs.lstat(join(retained, 'install')), { code: 'ENOENT' });
    else {
      assert.equal((await fs.stat(join(retained, 'install'))).mode & 0o7777, 0o775);
      assert.equal(await fs.readFile(join(retained, 'install/kept'), 'utf8'), 'outside retained bytes');
      assert.equal((await fs.stat(join(retained, 'install/kept'))).mode & 0o7777, 0o640);
    }
  });
}
