import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { completeBootstrap } from '../../launcher/bootstrap-entry.mjs';
import { readInstallRecord } from '../../src/install-record.mjs';
import { buildBootstrap } from '../../launcher/build-bootstrap.mjs';
import { cases, temporary, put, repo, mutate } from './pkg-fixtures.mjs';
const execute = promisify(execFile);
async function fixture(t, c) {
  const home = await temporary(t), tools = join(home, 'stock-tools'), capture = join(home, 'captured-argv'), cwd = join(home, 'my project');
  await fs.mkdir(tools); await fs.mkdir(cwd);
  for (const tool of ['openssl', 'tar', 'gzip', 'awk', 'mktemp', 'mkdir', 'chmod', 'cat', 'find', 'cp']) {
    if (c.id === 'missing-verifier' && tool === 'openssl') continue;
    const path = (await execute('/bin/sh', ['-c', `command -v ${tool}`])).stdout.trim(); await fs.symlink(path, join(tools, tool));
  }
  const platform = c.given.platform ?? 'linux', arch = c.given.arch ?? 'x64', kernel = platform === 'darwin' ? 'Darwin' : platform === 'linux' ? 'Linux' : 'Windows_NT';
  await put(join(tools, 'uname'), `#!/bin/sh\ncase "$1" in -s) printf '%s\\n' '${kernel}' ;; -m) printf '%s\\n' '${arch === 'x64' ? 'x86_64' : 'arm64'}' ;; esac\n`, 0o755);
  await put(join(tools, 'df'), `#!/bin/sh\nprintf '%s\\n' 'Filesystem 1024-blocks Used Available Capacity Mounted' 'test 2000000 0 ${c.id === 'disk-below-stage-floor' ? 1048575 : 1048576} 1% /'\n`, 0o755);
  const nodeDir = join(home, `node-v22.16.0-${platform}-${arch}`);
  await put(join(nodeDir, 'bin/node'), `#!/bin/sh\nif [ "$1" = '-p' ]; then printf '%s\\n' '22.16.0|${platform}|${arch}'; else printf '%s\\n' "$PWD" "$@" > "$PDD_BOOTSTRAP_CAPTURE"; fi\n`, 0o755);
  await put(join(home, 'package/launcher/bootstrap-entry.mjs'), '// synthetic stand-in entry\n');
  if (c.given.extraDirectories) await put(join(home, 'package/.hidden/-nested/program'), 'retained executable bytes', 0o755);
  const nodeArchive = join(home, 'node.tar.gz'), alphaArchive = join(home, 'alpha.tar.gz');
  await execute('tar', ['-czf', nodeArchive, '-C', home, `node-v22.16.0-${platform}-${arch}`]);
  await execute('tar', ['-czf', alphaArchive, '-C', home, 'package']);
  const asset = async (path, url) => { const bytes = await fs.readFile(path); return { url, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, provenance: 'synthetic-release-fixture' }; };
  const descriptor = { releaseId: 'R1', pddVersion: '1.0.0', alpha: await asset(alphaArchive, 'https://release.invalid/alpha'), nodes: { [`${platform === 'win32' ? 'linux' : platform}-${arch}`]: { ...await asset(nodeArchive, 'https://release.invalid/node'), version: '22.16.0' } } };
  const installer = join(home, 'install.sh'); await buildBootstrap({ descriptor, destination: installer });
  await put(join(tools, 'curl'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in https://*/node) pdd_source=$PDD_NODE_ARCHIVE ;; https://*/alpha) pdd_source=$PDD_ALPHA_ARCHIVE ;; -o) shift; pdd_destination=$1 ;; esac; shift; done\n/bin/cp "$pdd_source" "$pdd_destination"\n', 0o755);
  const env = { ...process.env, HOME: home, PATH: tools, PDD_BOOTSTRAP_CAPTURE: capture, PDD_NODE_ARCHIVE: nodeArchive, PDD_ALPHA_ARCHIVE: alphaArchive };
  return { home, cwd, installer, capture, env };
}
for (const c of await cases('bootstrap')) test(c.id, async t => {
  if (c.id === 'missing-trust-root') {
    const home = await temporary(t);
    await assert.rejects(execute('/bin/sh', [join(repo, 'install.sh')], { env: { ...process.env, HOME: home } }), e => e.code === 1 && e.stderr.includes('verification_error') && e.stderr.split('Next:').length === 2);
    await assert.rejects(fs.lstat(join(home, '.pdd')), { code: 'ENOENT' }); return;
  }
  const f = await fixture(t, c), args = c.given.args ?? ['--no-phone'];
  const stock = ['stock-mac-no-node', 'stock-linux-no-node', 'unsupported-platform', 'disk-below-stage-floor', 'missing-verifier', 'literal-setup-argv', 'tool-choice-preserved', 'settings-once-per-machine-tool'].includes(c.id);
  let before;
  if (!stock) {
    await put(join(f.home, '.pdd/install/record.json'), JSON.stringify({ transaction: { id: 'T1', phase: 'activating' }, machineToolSettings: { codex: 'Auto' }, projectBaseFolder: '/home/user/pdd', toolDefaults: { codex: 'native' } }));
    await put(join(f.home, '.pdd/launcher/pdd-launch'), `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "$PDD_BOOTSTRAP_CAPTURE"\n${c.id === 'shim-shadowed-in-fresh-shell' ? "printf '%s\\n' 'legacy function' 'Next: Repair the fish shim precedence.' >&2\nexit 1\n" : ''}`, 0o755);
    before = await fs.readFile(join(f.home, '.pdd/install/record.json'));
  }
  let execution;
  try { execution = await execute('/bin/sh', [f.installer, ...args], { env: f.env, cwd: f.cwd }); }
  catch (e) { execution = e; }
  if (['unsupported-platform', 'disk-below-stage-floor', 'missing-verifier', 'shim-shadowed-in-fresh-shell'].includes(c.id)) {
    assert.equal(execution.code, 1); assert.equal(execution.stderr.split('Next:').length, 2);
    if (c.id === 'shim-shadowed-in-fresh-shell') assert.ok(execution.stderr.includes(c.expected.actualWinnerShown));
    else await assert.rejects(fs.lstat(f.capture), { code: 'ENOENT' });
  } else {
    assert.equal(execution.code, undefined, execution.stderr);
    const captured = (await fs.readFile(f.capture, 'utf8')).trimEnd().split('\n'); assert.equal(captured[0], f.cwd);
    if (stock) {
      assert.ok(captured[1].endsWith('/bootstrap/launcher/bootstrap-entry.mjs')); assert.equal(captured[2], f.home); assert.deepEqual(captured.slice(4), args);
    } else assert.deepEqual(captured.slice(1), ['cli', 'setup', ...args]);
    assert.ok(execution.stdout.includes('pdd setup')); assert.equal(execution.stdout.includes('--resume'), false);
  }
  if (before) assert.deepEqual(await fs.readFile(join(f.home, '.pdd/install/record.json')), before);
  await assert.rejects(fs.lstat(join(f.cwd, 'forbidden')), { code: 'ENOENT' });
});

test('release bootstrap rejects escaped identities and runtimes below the public engine floor before writing an installer', async t => {
  const home = await temporary(t), destination = join(home, 'install.sh');
  const asset = { url: 'https://release.invalid/artifact', sha256: 'a'.repeat(64), integrity: 'sha256-' + Buffer.alloc(32).toString('base64'), provenance: 'synthetic-pinned-release' };
  const descriptor = { releaseId: 'R1', pddVersion: '1.0.0', alpha: asset, nodes: { 'linux-x64': { ...asset, version: '22.16.0' } } };
  for (const releaseId of ['../R1', '/tmp/R1', 'R1/path', '.', '..', 'R1\nR2']) {
    await assert.rejects(buildBootstrap({ descriptor: { ...descriptor, releaseId }, destination }), TypeError);
  }
  for (const version of ['20.0.0', '22.15.9', '22.16', '22.16.0;touch forbidden']) {
    await assert.rejects(buildBootstrap({ descriptor: { ...descriptor, nodes: { 'linux-x64': { ...asset, version } } }, destination }), TypeError);
  }
  await assert.rejects(fs.access(destination), { code: 'ENOENT' });
});

test('stock installer creates every PDD directory 0700 under umask 002 before verified execution', async t => {
  const f = await fixture(t, { id: 'stock-linux-no-node', given: { platform: 'linux', arch: 'x64', extraDirectories: true } });
  const result = await execute('/bin/sh', ['-c', 'umask 002; exec /bin/sh "$1"', 'installer-case', f.installer], { env: f.env, cwd: f.cwd });
  assert.equal(result.stderr, '');
  const inspect = async path => {
    assert.equal((await fs.lstat(path)).mode & 0o7777, 0o700, path);
    for (const entry of await fs.readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await inspect(join(path, entry.name));
  };
  await inspect(join(f.home, '.pdd'));
  const [staged] = await fs.readdir(join(f.home, '.pdd/update/staging'));
  const program = join(f.home, '.pdd/update/staging', staged, 'alpha/.hidden/-nested/program');
  assert.equal(await fs.readFile(program, 'utf8'), 'retained executable bytes');
  assert.equal((await fs.stat(program)).mode & 0o100, 0o100);
  assert.ok(await fs.readFile(f.capture, 'utf8'));
});

test('installer repairs mutable PDD roots before delegation while immutable runtime trees and receipts stay untouched', async t => {
  const f = await fixture(t, { id: 'existing-managed', given: {} });
  const record = join(f.home, '.pdd/install/record.json'), saved = '{"transaction":{"id":"keep-this-target"}}';
  await put(record, saved);
  await put(join(f.home, '.pdd/launcher/pdd-launch'), '#!/bin/sh\nexit 0\n', 0o755);
  const mutable = ['logs', 'runs', 'fleet', 'accounts', 'claims', 'install', 'link'];
  for (const name of mutable) { await fs.mkdir(join(f.home, '.pdd', name), { recursive: true }); await fs.chmod(join(f.home, '.pdd', name), 0o775); }
  const runtime = join(f.home, '.pdd/versions/R1');
  await put(join(runtime, 'bin/program'), 'immutable program', 0o755);
  await put(join(runtime, '.pdd-release.json'), '{"treeDigest":"unchanged","artifactIdentity":"retained"}', 0o640);
  await fs.chmod(runtime, 0o775); await fs.chmod(join(runtime, 'bin'), 0o755);
  await fs.chmod(join(f.home, '.pdd'), 0o775);
  await execute('/bin/sh', [f.installer], { env: f.env, cwd: f.cwd });
  assert.equal((await fs.stat(join(f.home, '.pdd'))).mode & 0o7777, 0o700);
  assert.equal(await fs.readFile(record, 'utf8'), saved);
  for (const name of mutable) assert.equal((await fs.stat(join(f.home, '.pdd', name))).mode & 0o7777, 0o700);
  assert.equal((await fs.stat(runtime)).mode & 0o7777, 0o775);
  assert.equal((await fs.stat(join(runtime, 'bin'))).mode & 0o7777, 0o755);
  assert.equal(await fs.readFile(join(runtime, '.pdd-release.json'), 'utf8'), '{"treeDigest":"unchanged","artifactIdentity":"retained"}');
  assert.equal((await fs.stat(join(runtime, '.pdd-release.json'))).mode & 0o7777, 0o640);
  assert.equal(await fs.readFile(join(runtime, 'bin/program'), 'utf8'), 'immutable program');
});

test('existing-install setup success plainly discloses that the requested new release was not installed', async t => {
  const f = await fixture(t, { id: 'existing-managed', given: {} });
  const saved = '{"transaction":{"id":"old-release-retained"},"settings":{"keep":true}}';
  await put(join(f.home, '.pdd/install/record.json'), saved);
  await put(join(f.home, '.pdd/launcher/pdd-launch'), '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@" > "$PDD_BOOTSTRAP_CAPTURE"\nprintf "Existing setup completed.\\n"\n', 0o755);
  const result = await execute('/bin/sh', [f.installer, '--no-phone', 'literal argument'], { env: f.env, cwd: f.cwd });
  assert.match(result.stdout, /did not install a new release/i);
  assert.match(result.stdout, /existing PDD runtime is retained/i);
  assert.match(result.stdout, /Existing setup completed\./);
  assert.deepEqual((await fs.readFile(f.capture, 'utf8')).trimEnd().split('\n'), [f.cwd, 'cli', 'setup', '--no-phone', 'literal argument']);
  assert.equal(await fs.readFile(join(f.home, '.pdd/install/record.json'), 'utf8'), saved);
  await assert.rejects(fs.lstat(join(f.home, '.pdd/update/staging')), { code: 'ENOENT' });
});

for (const replacement of ['symlink', 'directory']) test(`stock installer refuses a replaced PDD ancestor without chmod outside: ${replacement}`, async t => {
  const f = await fixture(t, { id: 'existing-managed', given: {} });
  const root = join(f.home, '.pdd'), outside = join(f.home, 'outside'), saved = join(f.home, 'saved-pdd');
  await fs.mkdir(join(root, 'install'), { recursive: true });
  await fs.mkdir(join(outside, 'install'), { recursive: true });
  await fs.chmod(join(outside, 'install'), 0o775);
  await put(join(outside, 'install/kept'), 'outside retained bytes', 0o640);
  // Swap the named ancestor after root repair, while the installer retains its
  // entered directory. Real chmod and all ordinary stock-shell logic still run.
  await fs.unlink(join(f.env.PATH, 'chmod'));
  await put(join(f.env.PATH, 'chmod'), `#!/bin/sh
/bin/chmod "$@"
if [ ! -e "$PDD_SWAP_MARKER" ]; then
  : > "$PDD_SWAP_MARKER"
  /bin/mv "$HOME/.pdd" "$HOME/saved-pdd"
  ${replacement === 'symlink' ? '/bin/ln -s "$HOME/outside" "$HOME/.pdd"' : '/bin/mv "$HOME/outside" "$HOME/.pdd"'}
fi
`, 0o755);
  const marker = join(f.home, 'substitution-observed');
  await assert.rejects(execute('/bin/sh', [f.installer], { env: { ...f.env, PDD_SWAP_MARKER: marker }, cwd: f.cwd }), e => e.code === 1);
  await fs.access(marker); await fs.access(saved);
  const retained = replacement === 'directory' ? root : outside;
  assert.equal((await fs.stat(join(retained, 'install'))).mode & 0o7777, 0o775);
  assert.equal(await fs.readFile(join(retained, 'install/kept'), 'utf8'), 'outside retained bytes');
  assert.equal((await fs.stat(join(retained, 'install/kept'))).mode & 0o7777, 0o640);
  await assert.rejects(fs.lstat(f.capture), { code: 'ENOENT' });
});

for (const replacement of ['final-directory', 'ancestor']) test(`fresh extraction normalization retains directory authority before chmod: ${replacement}`, async t => {
  const f = await fixture(t, { id: 'stock-linux-no-node', given: {} });
  const outside = join(f.home, 'outside'), marker = join(f.home, 'normalization-substitution');
  await fs.mkdir(join(outside, 'launcher'), { recursive: true });
  await fs.chmod(outside, 0o775); await fs.chmod(join(outside, 'launcher'), 0o775);
  await put(join(outside, 'kept'), 'outside retained bytes', 0o640);
  await fs.unlink(join(f.env.PATH, 'chmod'));
  await put(join(f.env.PATH, 'chmod'), `#!/bin/sh
if [ ! -e "$PDD_SWAP_MARKER" ]; then
  for stage in "$HOME"/.pdd/update/staging/bootstrap-*; do
    if [ -d "$stage/alpha/launcher" ]; then
      target="$stage/alpha${replacement === 'final-directory' ? '/launcher' : ''}"
      matched=false
      [ "$PWD" = "$target" ] && matched=true
      for operand do [ "$operand" = "$target" ] && matched=true; done
      if [ "$matched" = true ]; then
        : > "$PDD_SWAP_MARKER"
        /bin/mv "$target" "$HOME/saved-extraction"
        /bin/ln -s "$HOME/outside" "$target"
      fi
    fi
  done
fi
/bin/chmod "$@"
`, 0o755);
  const outcome = await execute('/bin/sh', [f.installer], { env: { ...f.env, PDD_SWAP_MARKER: marker }, cwd: f.cwd }).catch(error => error);
  await fs.access(marker);
  assert.equal((await fs.stat(outside)).mode & 0o7777, 0o775);
  assert.equal((await fs.stat(join(outside, 'launcher'))).mode & 0o7777, 0o775);
  assert.equal(await fs.readFile(join(outside, 'kept'), 'utf8'), 'outside retained bytes');
  assert.equal((await fs.stat(join(outside, 'kept'))).mode & 0o7777, 0o640);
  assert.equal(outcome.code, 1); await assert.rejects(fs.lstat(f.capture), { code: 'ENOENT' });
});

async function recoveryStage(home, suffix) {
  const stage = join(home, '.pdd/update/staging/bootstrap-' + suffix);
  await fs.mkdir(join(stage, 'node/bin'), { recursive: true }); await fs.link(process.execPath, join(stage, 'node/bin/node'));
  for (const directory of ['src', 'launcher']) await fs.cp(join(repo, directory), join(stage, 'alpha', directory), { recursive: true });
  await put(join(stage, 'alpha/bin/pdd.mjs'), '// synthetic candidate\n');
  await put(join(stage, 'alpha/package.json'), '{"type":"module","version":"1.0.0"}');
  const asset = async name => { const bytes = Buffer.from('verified synthetic ' + name); await fs.writeFile(join(stage, name + '.tar.gz'), bytes); return { url: 'https://release.invalid/' + name, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'), provenance: 'synthetic pinned descriptor' }; };
  const descriptor = { releaseId: 'R1', pddVersion: '1.0.0', alpha: await asset('alpha'), nodes: { [`${process.platform}-${process.arch}`]: { ...await asset('node'), version: process.versions.node } } };
  await fs.writeFile(join(stage, 'release.json'), JSON.stringify(descriptor)); return stage;
}
test('verified first-install retry resumes its original pre-flip intent without a recovery launcher', async t => {
  const home = await temporary(t), firstStage = await recoveryStage(home, 'first');
  await assert.rejects(completeBootstrap({ home, stage: firstStage }, { selfTest: async () => false }), /stage_failed/);
  const before = (await readInstallRecord({ home })).value, id = Object.keys(before.staging)[0];
  const stage = await recoveryStage(home, 'retry');
  await assert.rejects(completeBootstrap({ home, stage }), /bootstrap_busy/);
  assert.deepEqual((await readInstallRecord({ home })).value, before);
  await mutate(home, next => { next.staging[id].phase = 'downloading'; next.staging[id].processProof = { pid: 2147483647, birth: 'gone', bootId: 'gone' }; });
  const saved = (await readInstallRecord({ home })).value;
  const descriptorPath = join(stage, 'release.json'), originalDescriptor = await fs.readFile(descriptorPath, 'utf8');
  await fs.writeFile(descriptorPath, JSON.stringify({ ...JSON.parse(originalDescriptor), releaseId: 'R2' }));
  await assert.rejects(completeBootstrap({ home, stage }), /recovery_required/);
  assert.deepEqual((await readInstallRecord({ home })).value, saved);
  await fs.writeFile(descriptorPath, originalDescriptor);
  const installed = await completeBootstrap({ home, stage }, { selfTest: async () => true, activateRecoveryService: async () => {} });
  assert.equal(installed.transactionId, id); assert.equal((await readInstallRecord({ home })).value.transaction.phase, 'ready');
  assert.deepEqual(Object.keys((await readInstallRecord({ home })).value.staging), [id]);
  assert.equal(await fs.realpath(join(home, '.pdd/current')), installed.runtime.versionRoot); await fs.access(join(home, '.pdd/launcher/pdd-launch'), 1);
});
test('verified first-install retry repairs missing support after a flip without repeating activation', async t => {
  const home = await temporary(t), firstStage = await recoveryStage(home, 'first');
  await assert.rejects(completeBootstrap({ home, stage: firstStage }, { selfTest: async () => true, activateRecoveryService: async () => { throw Error('service unavailable'); } }), /service_unavailable/);
  const before = (await readInstallRecord({ home })).value, id = before.transaction.id, inode = (await fs.lstat(join(home, '.pdd/current'))).ino;
  await fs.rm(join(home, '.pdd/launcher'), { recursive: true }); await fs.rm(join(home, '.pdd/bin'), { recursive: true });
  await mutate(home, next => { next.transaction.phase = 'activating'; next.staging[id].processProof = { pid: 2147483647, birth: 'gone', bootId: 'gone' }; });
  const installed = await completeBootstrap({ home, stage: await recoveryStage(home, 'retry') }, { selfTest: async () => assert.fail('completed publication must be recovered'), activateRecoveryService: async () => {} });
  assert.equal(installed.transactionId, id); assert.equal((await fs.lstat(join(home, '.pdd/current'))).ino, inode);
  assert.equal((await readInstallRecord({ home })).value.transaction.phase, 'ready'); await fs.access(join(home, '.pdd/launcher/pdd-launch'), 1);
});
test('verified shell rerun with a record but missing launcher reaches verified bootstrap recovery', async t => {
  const f = await fixture(t, { id: 'stock-linux-no-node', given: {} });
  const record = '{"savedFirstInstall":"preserve"}'; await put(join(f.home, '.pdd/install/record.json'), record);
  await execute('/bin/sh', [f.installer, 'literal argument'], { env: f.env, cwd: f.cwd });
  assert.ok((await fs.readFile(f.capture, 'utf8')).includes('/bootstrap/launcher/bootstrap-entry.mjs'));
  assert.equal(await fs.readFile(join(f.home, '.pdd/install/record.json'), 'utf8'), record);
});

// Platform-branch simulation on Linux: real ps and kernel update locks, with
// only the unavailable Mac boot-time command and service activation substituted.
async function macCommands(file, args, config) {
  assert.equal(config.env.LC_ALL, 'C'); assert.equal(config.env.TZ, 'UTC');
  if (file === '/usr/sbin/sysctl') {
    assert.deepEqual(args, ['-n', 'kern.boottime']);
    return { stdout: '{ sec = 1700000000, usec = 123456 } synthetic boot\n' };
  }
  assert.equal(file, '/bin/ps'); return execute(file, args, config);
}
async function macBranch(operation) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...original, value: 'darwin' });
  try { return await operation(); } finally { Object.defineProperty(process, 'platform', original); }
}
const macOptions = { bootstrapExecFile: macCommands, selfTest: async () => true, activateRecoveryService: async () => {} };

test('Mac bootstrap excludes live and stopped owners, then recovers the dead owner original pre-flip intent', { timeout: 30000 }, async t => {
  const home = await temporary(t), stage = await macBranch(() => recoveryStage(home, 'first'));
  const script = `
    import {completeBootstrap} from ${JSON.stringify(pathToFileURL(join(repo, 'launcher/bootstrap-entry.mjs')).href)};
    import {execFile} from 'node:child_process'; import {promisify} from 'node:util';
    const execute=promisify(execFile);
    Object.defineProperty(process,'platform',{value:'darwin'});
    try { await completeBootstrap(${JSON.stringify({ home, stage })},{
      bootstrapExecFile:(file,args,config)=>file==='/usr/sbin/sysctl'?{stdout:'{ sec = 1700000000, usec = 123456 }'}:execute(file,args,config),
      selfTest:async()=>false
    }); process.send({error:'unexpected success'}); }
    catch(e) { process.send({error:e.message}); }
    setInterval(()=>{},1000);
  `;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = once(owner, 'exit');
  t.after(async () => { if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL'); await exited; });
  let stderr = ''; owner.stderr.on('data', b => { stderr += b; });
  const reported = await Promise.race([once(owner, 'message'), exited.then(() => { throw Error(stderr || 'owner exited before checkpoint'); })]);
  assert.deepEqual(reported[0], { error: 'stage_failed' }, stderr);
  const before = (await readInstallRecord({ home })).value, id = Object.keys(before.staging)[0], saved = before.staging[id].processProof;
  assert.equal(saved.pid, owner.pid); assert.match(saved.birth, /^darwin-lstart:/); assert.match(saved.bootId, /^darwin-boottime:/);
  const retryStage = await macBranch(() => recoveryStage(home, 'retry'));
  await macBranch(async () => {
    await assert.rejects(completeBootstrap({ home, stage: retryStage }, macOptions), /bootstrap_busy/);
    owner.kill('SIGSTOP');
    assert.match((await execute('/bin/ps', ['-p', String(owner.pid), '-o', 'stat='])).stdout, /T/);
    await assert.rejects(completeBootstrap({ home, stage: retryStage }, macOptions), /bootstrap_busy/);
    for (const output of [null, '']) {
      const unreadableOwner = async (file, args, config) => {
        if (file === '/bin/ps' && args[1] === String(owner.pid)) {
          if (output === null) throw Error('owner query denied');
          return { stdout: output };
        }
        return macCommands(file, args, config);
      };
      await assert.rejects(completeBootstrap({ home, stage: retryStage }, { ...macOptions, bootstrapExecFile: unreadableOwner }), /recovery_required/);
    }
    assert.deepEqual((await readInstallRecord({ home })).value, before);
    owner.kill('SIGKILL'); await exited;
    const path = join(retryStage, 'release.json'), text = await fs.readFile(path, 'utf8');
    await fs.writeFile(path, JSON.stringify({ ...JSON.parse(text), releaseId: 'R2' }));
    await assert.rejects(completeBootstrap({ home, stage: retryStage }, macOptions), /recovery_required/);
    assert.deepEqual((await readInstallRecord({ home })).value, before);
    await fs.writeFile(path, text);
    const installed = await completeBootstrap({ home, stage: retryStage }, macOptions);
    assert.equal(installed.transactionId, id);
    const after = (await readInstallRecord({ home })).value;
    assert.deepEqual(Object.keys(after.staging), [id]); assert.deepEqual(after.staging[id].target, before.staging[id].target);
    assert.equal(after.transaction.phase, 'ready'); await fs.access(join(home, '.pdd/launcher/pdd-launch'), 1);
  });
});

test('Mac bootstrap repairs post-flip support after proven instance replacement without repeating activation', async t => {
  const home = await temporary(t);
  await macBranch(async () => {
    const first = await recoveryStage(home, 'first');
    await assert.rejects(completeBootstrap({ home, stage: first }, { ...macOptions, activateRecoveryService: async () => { throw Error('service unavailable'); } }), /service_unavailable/);
    const before = (await readInstallRecord({ home })).value, id = before.transaction.id, inode = (await fs.lstat(join(home, '.pdd/current'))).ino;
    await fs.rm(join(home, '.pdd/launcher'), { recursive: true }); await fs.rm(join(home, '.pdd/bin'), { recursive: true });
    await mutate(home, next => { next.transaction.phase = 'activating'; next.staging[id].processProof.birth = 'darwin-lstart:Mon Jan 1 00:00:00 2001'; });
    const installed = await completeBootstrap({ home, stage: await recoveryStage(home, 'retry') }, { ...macOptions, selfTest: async () => assert.fail('must recover publication') });
    assert.equal(installed.transactionId, id); assert.equal((await fs.lstat(join(home, '.pdd/current'))).ino, inode);
    assert.equal((await readInstallRecord({ home })).value.transaction.phase, 'ready'); await fs.access(join(home, '.pdd/launcher/pdd-launch'), 1);
  });
});

test('Mac bootstrap refuses legacy null ownership, unreadable live ownership and ambiguous identity without mutation', async t => {
  const home = await temporary(t);
  await macBranch(async () => {
    const first = await recoveryStage(home, 'first');
    await assert.rejects(completeBootstrap({ home, stage: first }, { ...macOptions, selfTest: async () => false }), /stage_failed/);
    const before = (await readInstallRecord({ home })).value, id = Object.keys(before.staging)[0], stage = await recoveryStage(home, 'retry');
    for (const mode of ['command-failure', 'malformed-boot', 'malformed-start']) {
      const unavailable = async (file, args, config) => {
        if (mode === 'command-failure') throw Error('permission denied');
        if (mode === 'malformed-boot' || file === '/bin/ps') return { stdout: 'unreadable' };
        return macCommands(file, args, config);
      };
      await assert.rejects(completeBootstrap({ home, stage }, { ...macOptions, bootstrapExecFile: unavailable }), /recovery_required/);
      assert.deepEqual((await readInstallRecord({ home })).value, before);
    }
    // Same coarse identity remains live, even when a caller suspects PID reuse.
    await assert.rejects(completeBootstrap({ home, stage }, macOptions), /bootstrap_busy/);
    const proof = before.staging[id].processProof;
    for (const unknown of [null, { ...proof, pid: 1 }, { ...proof, birth: 'darwin-lstart:unreadable' }, { ...proof, bootId: 'unknown' }]) {
      await mutate(home, next => { next.staging[id].processProof = unknown; });
      const legacy = (await readInstallRecord({ home })).value;
      await assert.rejects(completeBootstrap({ home, stage }, macOptions), /recovery_required/);
      assert.deepEqual((await readInstallRecord({ home })).value, legacy);
    }
  });
});

test('Mac bootstrap saves no intent when fresh process identity cannot be established', async t => {
  const home = await temporary(t);
  await macBranch(async () => {
    const stage = await recoveryStage(home, 'first');
    await assert.rejects(completeBootstrap({ home, stage }, { ...macOptions, bootstrapExecFile: async () => { throw Error('unavailable'); } }), /recovery_required/);
    assert.equal((await readInstallRecord({ home })).value, null);
  });
});
