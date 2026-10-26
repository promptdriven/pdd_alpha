import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runPdd } from '../../src/pdd-cli.mjs';
import { withUpdateLock } from '../../src/update-lock.mjs';
import { temporary, runtime, pointer, seed, put, repo } from './pkg-fixtures.mjs';
const execute = promisify(execFile);
const stream = () => ({ text: '', write(s) { this.text += s; } });
const capture = home => ({ home, stdout: stream(), stderr: stream() });

test('C9 plain update shows unknown local state without creating an install', async t => {
  const home = await temporary(t), io = capture(home);
  assert.equal(await runPdd(['update'], io), 0);
  assert.match(io.stdout.text, /Current: none/); assert.match(io.stdout.text, /Previous: none/);
  for (const field of ['Target', 'Mode', 'Channel', 'Pin']) assert.match(io.stdout.text, new RegExp(field + ':'));
  assert.match(io.stdout.text, /release selector/); assert.match(io.stdout.text, /has not been checked/);
  assert.equal(io.stderr.text, ''); assert.deepEqual(await fs.readdir(home), []);
});

test('C9 plain update reads actual runtime identities and local policy without taking the update lock', async t => {
  const home = await temporary(t), io = capture(home), current = await runtime(home, 'R2', { version: '2.0.0' }), previous = await runtime(home, 'R1');
  await pointer(home, 'current', current); await pointer(home, 'previous', previous);
  await seed(home, { mode: 'ask', channel: 'beta', pin: '2.0', secret: 'never print me' });
  const path = join(home, '.pdd/install/record.json'), before = await fs.readFile(path), stat = await fs.stat(path);
  await withUpdateLock({ home }, async () => assert.equal(await runPdd(['update'], io), 0));
  assert.match(io.stdout.text, /Current: 2.0.0 \(R2\)/); assert.match(io.stdout.text, /Previous: 1.0.0 \(R1\)/);
  assert.match(io.stdout.text, /Mode: ask/); assert.match(io.stdout.text, /Channel: beta/); assert.match(io.stdout.text, /Pin: 2.0/);
  assert.doesNotMatch(io.stdout.text, /never print me|Update ready|No update available/);
  assert.deepEqual(await fs.readFile(path), before); assert.equal((await fs.stat(path)).mtimeMs, stat.mtimeMs);
});

test('C9 plain update keeps damaged state visible and unchanged with exit zero', async t => {
  const home = await temporary(t), io = capture(home), path = join(home, '.pdd/install/record.json');
  await put(path, '{damaged private content'); await fs.symlink(join(home, 'missing-runtime'), join(home, '.pdd/current'));
  assert.equal(await runPdd(['update'], io), 0);
  assert.match(io.stdout.text, /Current: unavailable/); assert.match(io.stdout.text, /record is damaged/);
  assert.doesNotMatch(io.stdout.text, /damaged private content/); assert.equal(await fs.readFile(path, 'utf8'), '{damaged private content');
});

test('C9 plain update explains unreadable state without leaking raw filesystem errors', async t => {
  const home = await temporary(t), io = capture(home);
  const denied = () => { throw Object.assign(new Error('secret-file-path-and-token'), { code: 'EACCES' }); };
  assert.equal(await runPdd(['update'], { ...io, ports: { fs: { lstat: denied, readFile: denied } } }), 0);
  assert.match(io.stdout.text, /could not be read|cannot read/); assert.doesNotMatch(io.stdout.text + io.stderr.text, /secret-file-path-and-token/);
  assert.deepEqual(await fs.readdir(home), []);
});

for (const args of [['update', '--check'], ['update', '--now'], ['update', '--channel', 'beta'], ['update', '--fleet']]) {
  test('C9 unavailable public update action has a plain cause and no effects: ' + args.join(' '), async t => {
    const home = await temporary(t), io = capture(home);
    assert.equal(await runPdd(args, io), 1);
    assert.match(io.stderr.text, args.includes('--fleet') ? /needs? the fleet client/ : /does not include the release selector/);
    assert.doesNotMatch(io.stderr.text, /operation unconfirmed|No update available/);
    assert.equal(io.stdout.text, ''); assert.deepEqual(await fs.readdir(home), []);
  });
}

for (const code of ['ERR_MODULE_NOT_FOUND', 'EACCES', 'ETIMEDOUT']) {
  test('C9 injected updater failure preserves a safe actionable reason: ' + code, async t => {
    const io = capture(await temporary(t));
    const updateModule = { runUpdateCommand: async () => { throw Object.assign(new Error('secret-error-details'), { code }); } };
    assert.equal(await runPdd(['update', '--check'], { ...io, updateModule }), 1);
    assert.match(io.stderr.text, /not installed|Permission|timed out/); assert.match(io.stderr.text, /pdd doctor/);
    assert.doesNotMatch(io.stderr.text, /secret-error-details|operation unconfirmed/);
  });
}

test('C9 supplied updater results stay authoritative and a failed plain show falls back once', async t => {
  const home = await temporary(t), io = capture(home); let calls = 0;
  const updateModule = { runUpdateCommand: async input => { calls++; assert.equal(input.action, 'check'); return { code: 1, message: 'No release note for beta.' }; } };
  assert.equal(await runPdd(['update', '--check'], { ...io, updateModule }), 1); assert.equal(io.stderr.text, 'No release note for beta.\n');
  for (const response of [null, { code: 1, message: 'Status read failed.' }]) {
    const fallback = capture(home);
    assert.equal(await runPdd(['update'], { ...fallback, updateModule: { runUpdateCommand: async () => { calls++; return response; } } }), 0);
    assert.match(fallback.stdout.text, /Current: none/);
    if(response) assert.equal(fallback.stderr.text, 'Status read failed.\n'); else assert.match(fallback.stderr.text, /adapter/);
  }
  assert.equal(calls, 3); assert.deepEqual(await fs.readdir(home), []);
});

test('C9 actual packed clean install shows status and explains unavailable checking without private imports', async t => {
  const home = await temporary(t), archiveRoot = join(home, 'archive'); await fs.mkdir(archiveRoot);
  const pack = JSON.parse((await execute('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', archiveRoot], { cwd: repo })).stdout)[0];
  await execute('tar', ['-xzf', join(archiveRoot, pack.filename), '-C', archiveRoot]);
  const root = join(archiveRoot, 'package'), pkg = JSON.parse(await fs.readFile(join(root, 'package.json')));
  await assert.rejects(fs.access(join(root, 'src/updates/updater.mjs')), { code: 'ENOENT' });
  const installed = join(home, 'installed'), rt = await runtime(installed, 'clean-release', { version: pkg.version });
  await fs.cp(root, rt.versionRoot, { recursive: true }); await pointer(installed, 'current', rt); await seed(installed);
  const env = { ...process.env, HOME: installed }, entry = join(root, 'bin/pdd.mjs');
  const shown = await execute(process.execPath, [entry, 'update'], { env });
  assert.match(shown.stdout, /Current: .*\(clean-release\)/); assert.match(shown.stdout, /availability has not been checked/); assert.equal(shown.stderr, '');
  await assert.rejects(execute(process.execPath, [entry, 'update', '--check'], { env }), error => error.code === 1 && /does not include the release selector/.test(error.stderr));
  assert.equal(await fs.realpath(join(installed, '.pdd/current')), rt.versionRoot);
});
