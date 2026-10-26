import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildBootstrap } from '../../launcher/build-bootstrap.mjs';
import { directoryDigest } from '../../src/owned-node.mjs';
import { readInstallRecord } from '../../src/install-record.mjs';
import { temporary, put, repo } from './pkg-fixtures.mjs';

const execute = promisify(execFile);

// Actual shell, shipped entry/modules/native helpers, selected Node, activation,
// launcher and public setup. Only HTTPS delivery, native login status, Herdr and service-manager
// commands are local stand-ins; the restricted PATH cannot reach a real service.
async function stockRuntime(t) {
  const root = await temporary(t), home = join(root, 'home'), tools = join(root, 'tools');
  const cwd = join(root, 'caller project'), capture = join(root, 'service-calls');
  const authCapture = join(root, 'native-status-calls');
  // The caller home is private; installer children still run under umask 002.
  await fs.mkdir(home, { mode: 0o700 }); await fs.mkdir(tools); await fs.mkdir(cwd);
  for (const name of ['uname', 'openssl', 'tar', 'gzip', 'awk', 'df', 'mktemp', 'mkdir', 'chmod', 'cat', 'cp']) {
    const file = (await execute('/bin/sh', ['-c', `command -v ${name}`])).stdout.trim();
    await fs.symlink(file, join(tools, name));
  }
  // SYNTHETIC OFFLINE manager: only the production persistence/readback argv
  // below is accepted. State transitions precede readiness; no real service runs.
  await put(join(tools, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$PDD_SERVICE_CALLS"
case "$*" in
  '--user daemon-reload') [ "$#" = 2 ] ;;
  '--user enable pdd-herdr-default.service') [ "$#" = 3 ] && : > "$PDD_HERDR_ENABLED" ;;
  '--user is-enabled pdd-herdr-default.service') [ "$#" = 3 ] && [ -f "$PDD_HERDR_ENABLED" ] && printf 'enabled\\n' ;;
  '--user start pdd-herdr-default.service') [ "$#" = 3 ] && [ -f "$PDD_HERDR_ENABLED" ] && [ -f "$PDD_HERDR_LINGER" ] && : > "$PDD_HERDR_ACTIVE" ;;
  '--user is-active pdd-herdr-default.service') [ "$#" = 3 ] && [ -f "$PDD_HERDR_ACTIVE" ] && printf 'active\\n' ;;
  '--user enable --now pdd-runs-keeper.service') [ "$#" = 4 ] && [ "\${PDD_SERVICE_FAILURE:-0}" = 0 ] ;;
  *) exit 98 ;;
esac
`, 0o755);
  await put(join(tools, 'loginctl'), `#!/bin/sh
printf 'loginctl %s\\n' "$*" >> "$PDD_SERVICE_CALLS"
case "$*" in
  '--no-ask-password enable-linger ${process.getuid()}') [ "$#" = 3 ] && : > "$PDD_HERDR_LINGER" ;;
  'show-user ${process.getuid()} --property=Linger --value') [ "$#" = 4 ] && [ -f "$PDD_HERDR_LINGER" ] && printf 'yes\\n' ;;
  *) exit 98 ;;
esac
`, 0o755);
  await put(join(tools, 'systemd-run'), '#!/bin/sh\nexit 99\n', 0o755);
  await put(join(tools, 'herdr'), `#!/bin/sh
printf '%s\\n' "$*" >> "$PDD_HERDR_CALLS"
case "$*" in
  --help) [ "$#" = 1 ] && printf 'Herdr synthetic-offline help\\n' ;;
  --version) [ "$#" = 1 ] && printf 'herdr synthetic-offline\\n' ;;
  '--session default workspace list') [ "$#" = 4 ] && [ -f "$PDD_HERDR_ACTIVE" ] && printf '{"result":{"workspaces":[]}}\\n' ;;
  *) exit 98 ;;
esac
`, 0o755);
  // SYNTHETIC OFFLINE status fixture: no login, credentials or model invocation.
  await put(join(tools, 'codex'), '#!/bin/sh\nprintf \"<%s>\\n\" \"$@\" >> \"$PDD_AUTH_CALLS\"\n[ "$#" = 2 ] && [ "$1" = login ] && [ "$2" = status ] || exit 98\nprintf "Logged in using ChatGPT\\n"\n', 0o700);
  const nodeName = `node-v${process.versions.node}-${process.platform}-${process.arch}`;
  const nodeTree = join(root, nodeName), alpha = join(root, 'package');
  await fs.mkdir(join(nodeTree, 'bin'), { recursive: true });
  await fs.copyFile(process.execPath, join(nodeTree, 'bin/node'));
  await fs.mkdir(alpha);
  for (const path of ['src', 'launcher', 'bin', 'docs', 'skills/pdd', '.pdd/workflows', 'package.json']) {
    await fs.cp(join(repo, path), join(alpha, path), { recursive: true });
  }
  const nodeArchive = join(root, 'node.tar.gz'), alphaArchive = join(root, 'alpha.tar.gz');
  await execute('tar', ['-czf', nodeArchive, '-C', root, nodeName], { env: { ...process.env, GZIP: '-1' } });
  await execute('tar', ['-czf', alphaArchive, '-C', root, 'package']);
  const asset = async (path, name) => {
    const bytes = await fs.readFile(path);
    return { url: `https://release.invalid/${name}`, sha256: createHash('sha256').update(bytes).digest('hex'),
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'), provenance: 'synthetic offline release' };
  };
  const descriptor = { releaseId: 'C4-stock', pddVersion: JSON.parse(await fs.readFile(join(alpha, 'package.json'))).version,
    alpha: await asset(alphaArchive, 'alpha'), nodes: { [`${process.platform}-${process.arch}`]: { ...await asset(nodeArchive, 'node'), version: process.versions.node } } };
  const installer = join(root, 'install.sh');
  await buildBootstrap({ descriptor, destination: installer });
  await put(join(tools, 'curl'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in https://release.invalid/node) source=$PDD_NODE_ARCHIVE ;; https://release.invalid/alpha) source=$PDD_ALPHA_ARCHIVE ;; -o) shift; destination=$1 ;; esac; shift; done\n[ -n "${source:-}" ] && [ -n "${destination:-}" ] || exit 97\n/bin/cp "$source" "$destination"\n', 0o755);
  const env = { HOME: home, PATH: tools, LC_ALL: 'C', PDD_SERVICE_CALLS: capture, PDD_AUTH_CALLS: authCapture, PDD_HERDR_CALLS: join(root, 'herdr-calls'), PDD_HERDR_ENABLED: join(root, 'herdr-enabled'), PDD_HERDR_LINGER: join(root, 'herdr-linger'), PDD_HERDR_ACTIVE: join(root, 'herdr-active'), PDD_NODE_ARCHIVE: nodeArchive, PDD_ALPHA_ARCHIVE: alphaArchive };
  const run = extra => execute('/bin/sh', ['-c', 'umask 002; exec /bin/sh "$1" --no-phone', 'stock-case', installer], { cwd, env: { ...env, ...extra }, timeout: 90000 }).catch(async error => {
    const manager = await fs.readFile(capture, 'utf8').catch(() => '(no manager calls)');
    const herdr = await fs.readFile(env.PDD_HERDR_CALLS, 'utf8').catch(() => '(no Herdr calls)');
    error.message += `\nSynthetic manager calls:\n${manager}\nSynthetic Herdr calls:\n${herdr}`;
    throw error;
  });
  return { home, tools, capture, authCapture, herdrCapture: env.PDD_HERDR_CALLS, run };
}

async function assertHerdrPersistence(f, setups) {
  const calls=(await fs.readFile(f.capture,'utf8')).trim().split('\n');
  assert.equal(calls.filter(c=>c==='--user enable pdd-herdr-default.service').length,setups);
  assert.equal(calls.filter(c=>c===`loginctl --no-ask-password enable-linger ${process.getuid()}`).length,setups);
  assert.equal(calls.filter(c=>c==='--user is-enabled pdd-herdr-default.service').length,setups);
  assert.equal(calls.filter(c=>c===`loginctl show-user ${process.getuid()} --property=Linger --value`).length,setups);
  assert.equal(calls.filter(c=>c==='--user start pdd-herdr-default.service').length,1);
  const reads=(await fs.readFile(f.herdrCapture,'utf8')).trim().split('\n');
  assert.deepEqual(reads,setups===2?['--help','--session default workspace list','--session default workspace list','--help','--session default workspace list']:['--help','--session default workspace list','--session default workspace list']);
  const service=await fs.readFile(join(f.home,'.config/systemd/user/pdd-herdr-default.service'),'utf8');
  assert.ok(service.includes(`ExecStart="${join(f.tools,'herdr')}" server`));
  assert.equal((await fs.stat(join(f.home,'.config/systemd/user/pdd-herdr-default.service'))).mode&0o777,0o600);
}

test('stock installer reaches real public setup after publication; rerun discloses retained release and repairs only mutable roots', { timeout: 120000 }, async t => {
  const f = await stockRuntime(t);
  const first = await f.run();
  assert.match(first.stdout, /Public recovery service ready\./);
  assert.doesNotMatch(first.stderr, /lock_unavailable|record_io/);
  const record = (await readInstallRecord({ home: f.home })).value;
  assert.equal(record.transaction.phase, 'ready'); assert.equal(record.transaction.to.releaseId, 'C4-stock');
  const runtime = record.transaction.to;
  assert.equal(await fs.realpath(join(f.home, '.pdd/current')), runtime.versionRoot);
  await fs.access(join(f.home, '.pdd/launcher/pdd-launch'), 1);
  assert.equal(record.herdr, join(f.tools, 'herdr'));
  const inspect = async path => {
    assert.equal((await fs.lstat(path)).mode & 0o7777, 0o700, path);
    for (const entry of await fs.readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await inspect(join(path, entry.name));
  };
  await inspect(join(f.home, '.pdd'));
  const immutable = [runtime.versionRoot, join(f.home, '.pdd/tools/node', runtime.nodeVersion)];
  const snapshots = [];
  for (const path of immutable) {
    // Simulate a historical published tree. The private parent suffices; its
    // directory modes and mode-sensitive integrity receipt must remain exact.
    await fs.chmod(path, 0o775);
    snapshots.push({ path, mode: (await fs.stat(path)).mode, digest: await directoryDigest(path),
      receipt: await fs.readFile(join(path, path === runtime.versionRoot ? '.pdd-release.json' : '.pdd-node.json')) });
  }
  // Only the root mode was widened; descendants and receipts remain valid.
  const mutable = ['logs', 'runs', 'fleet', 'accounts', 'claims', 'install', 'link'];
  for (const name of mutable) { await fs.mkdir(join(f.home, '.pdd', name), { recursive: true }); await fs.chmod(join(f.home, '.pdd', name), 0o775); }
  await fs.chmod(join(f.home, '.pdd'), 0o775);
  const second = await f.run();
  assert.match(second.stdout, /did not install a new release/i);
  assert.match(second.stdout, /existing.*retained/i);
  assert.match(second.stdout, /Public recovery service ready\./);
  assert.equal((await fs.stat(join(f.home, '.pdd'))).mode & 0o7777, 0o700);
  for (const name of mutable) assert.equal((await fs.stat(join(f.home, '.pdd', name))).mode & 0o7777, 0o700);
  for (const item of snapshots) {
    assert.equal((await fs.stat(item.path)).mode, item.mode);
    assert.equal(await directoryDigest(item.path), item.digest);
    assert.deepEqual(await fs.readFile(join(item.path, item.path === runtime.versionRoot ? '.pdd-release.json' : '.pdd-node.json')), item.receipt);
  }
  assert.equal((await readInstallRecord({ home: f.home })).value.transaction.id, record.transaction.id);
  assert.match(await fs.readFile(f.capture, 'utf8'), /enable --now pdd-runs-keeper\.service/);
  await assert.rejects(fs.readFile(f.authCapture, 'utf8'), { code: 'ENOENT' });
  await assertHerdrPersistence(f, 2);
});

test('stock installer preserves a genuine service failure after ready runtime publication', { timeout: 120000 }, async t => {
  const f = await stockRuntime(t);
  await assert.rejects(f.run({ PDD_SERVICE_FAILURE: '1' }), error => error.code === 1 && /service_unavailable/.test(error.stderr));
  const record = (await readInstallRecord({ home: f.home })).value;
  assert.equal(record.transaction.phase, 'ready');
  assert.equal(await fs.realpath(join(f.home, '.pdd/current')), record.transaction.to.versionRoot);
  assert.equal((await fs.stat(join(f.home, '.pdd'))).mode & 0o7777, 0o700);
});


test('fresh stock installer removes only old global npm Alpha after the managed runtime is ready', { timeout: 120000 }, async t => {
  const f = await stockRuntime(t), legacy = join(f.home, 'legacy global'), calls = join(f.home, 'npm-calls');
  await put(join(legacy, 'pdd/package.json'), JSON.stringify({ name: 'pdd', repository: { url: 'git+https://github.com/promptdriven/pdd_alpha.git' } }));
  await put(join(legacy, 'unrelated/kept'), 'unrelated package');
  await put(join(f.tools, 'pdd'), '#!/bin/sh\nprintf "Python pdd-cli\\n"\n', 0o755);
  await put(join(f.tools, 'npm'), `#!/bin/sh
printf '%s\\n' "$*" >> "$S66_CALLS"
if [ "$*" = 'root --global' ]; then printf '%s\\n' "$S66_ROOT"; exit 0; fi
[ "$*" = 'uninstall --global --ignore-scripts --no-audit --no-fund pdd' ] || exit 97
node --input-type=module -e 'import{readFileSync,realpathSync}from"node:fs";const r=JSON.parse(readFileSync(process.env.HOME+"/.pdd/install/record.json"));if(r.transaction.phase!=="ready"||realpathSync(process.env.HOME+"/.pdd/current")!==r.transaction.to.versionRoot)process.exit(96);' || exit 95
/bin/rm -r "$S66_ROOT/pdd"
`, 0o755);
  const result = await f.run({ S66_ROOT: legacy, S66_CALLS: calls });
  await assert.rejects(fs.readFile(f.authCapture, 'utf8'), { code: 'ENOENT' });
  await assertHerdrPersistence(f, 1);
  assert.equal(result.stdout.split('Removed old global npm pdd (promptdriven/pdd_alpha).').length, 2);
  assert.match(result.stdout, /Public recovery service ready/);
  assert.deepEqual((await fs.readFile(calls, 'utf8')).trim().split('\n'), ['root --global', 'uninstall --global --ignore-scripts --no-audit --no-fund pdd']);
  await assert.rejects(fs.access(join(legacy, 'pdd')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(join(legacy, 'unrelated/kept'), 'utf8'), 'unrelated package');
  assert.equal((await execute(join(f.tools, 'pdd'), [], { env: { HOME: f.home, PATH: f.tools } })).stdout, 'Python pdd-cli\n');
  assert.equal((await fs.stat(join(f.home, '.pdd'))).mode & 0o7777, 0o700);
});
