import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { once } from 'node:events';
import { withUpdateLock, validUpdateLease, kernelLockHelper } from '../../src/update-lock.mjs';
import { cases, temporary, repo } from './pkg-fixtures.mjs';
const execute = promisify(execFile);

for (const c of await cases('update-lock')) test(c.id, async t => {
  const home = await temporary(t);
  if (c.id === 'kernel-binding-unavailable') {
    let calls = 0;
    const r = await withUpdateLock({ home }, () => calls++, { lockHelper: '/missing/kernel-helper' });
    assert.equal(r.code, c.expected.code); assert.equal(calls, c.expected.operationCalls); return;
  }
  if (c.id === 'persistent-inode') {
    await fs.mkdir(join(home, '.pdd')); await fs.writeFile(join(home, '.pdd/update.lock'), 'old pid');
    const before = await fs.stat(join(home, '.pdd/update.lock'));
    assert.equal(await withUpdateLock({ home }, lease => validUpdateLease(lease, home)), c.expected.acquired);
    assert.equal((await fs.stat(join(home, '.pdd/update.lock'))).ino, before.ino); return;
  }
  if (c.id === 'operation-throws') {
    await assert.rejects(withUpdateLock({ home }, () => { throw new Error(c.given.operationError); }), { message: c.expected.error });
    assert.equal(await withUpdateLock({ home }, () => true), true); return;
  }
  if (c.id === 'nested-helper-lease') {
    let saved;
    await withUpdateLock({ home }, async lease => { saved = lease; assert.equal(validUpdateLease(lease, home), true); assert.equal(validUpdateLease({}, home), false); });
    assert.equal(validUpdateLease(saved, home), false); return;
  }
  if (c.id === 'death-releases-kernel-lock') {
    const script = `import {withUpdateLock} from ${JSON.stringify(new URL('../../src/update-lock.mjs', import.meta.url).href)};await withUpdateLock({home:process.argv[1]},async()=>{process.stdout.write('held\\n');await new Promise(()=>{});});`;
    const owner = spawn(process.execPath, ['--input-type=module', '-e', script, home], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => owner.kill('SIGKILL'));
    await once(owner.stdout, 'data'); const inode = (await fs.stat(join(home, '.pdd/update.lock'))).ino;
    let calls = 0, acquired = false;
    const waiter = withUpdateLock({ home, onWait: () => { calls++; owner.kill('SIGKILL'); } }, () => acquired = true);
    await waiter; assert.equal(acquired, c.expected.BEventuallyAcquires); assert.equal(calls, 1);
    assert.equal((await fs.stat(join(home, '.pdd/update.lock'))).ino, inode); return;
  }
  let active = 0, max = 0, release;
  const blocked = new Promise(r => release = r), entered = Promise.withResolvers();
  const owner = withUpdateLock({ home }, async () => { active++; max = Math.max(max, active); entered.resolve(); await blocked; active--; });
  await entered.promise;
  if (c.id === 'stage-download-does-not-wait-for-setup') {
    await fs.mkdir(join(home, '.pdd/update/staging/T1'), { recursive: true });
    await fs.writeFile(join(home, '.pdd/update/staging/T1/artifact'), 'synthetic bytes');
    assert.equal(active, 1); release(); await owner; return;
  }
  const signal = new AbortController(); let waits = 0, calls = 0;
  const waiter = withUpdateLock({ home, signal: signal.signal, onWait: msg => {
    waits++; assert.equal(msg, 'Another setup or update is running. Waiting…');
    if (c.id === 'cancel-while-waiting') signal.abort();
    release();
  } }, async () => { calls++; active++; max = Math.max(max, active); active--; });
  const result = await waiter; await owner;
  if (c.id === 'cancel-while-waiting') { assert.equal(result.code, c.expected.code); assert.equal(calls, c.expected.BOperationCalls); }
  else { assert.equal(max, 1); assert.equal(waits, 1); assert.equal(calls, 1); }
});

test('S15 Linux: kernel exclusion survives exec and releases at native process death', async t => {
  const home = await temporary(t), path = join(home, 'claim.lock');
  const child = spawn(kernelLockHelper, ['--try-exec', path, '--', process.execPath, '-e', "process.stdout.write('exec-owned\\n');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL')); await once(child.stdout, 'data');
  const inode = (await fs.stat(path)).ino;
  await assert.rejects(execute(kernelLockHelper, ['--try-exec', path, '--', process.execPath, '-e', 'process.exit(0)']), { code: 73 });
  const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
  await execute(kernelLockHelper, ['--try-exec', path, '--', process.execPath, '-e', 'process.exit(0)']);
  assert.equal((await fs.stat(path)).ino, inode);
});
