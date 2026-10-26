import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cleanupLegacyNpm } from '../../launcher/npm-cleanup.mjs';
import { buildBootstrap } from '../../launcher/build-bootstrap.mjs';
import { temporary, put, repo } from './pkg-fixtures.mjs';
const execute = promisify(execFile);

async function fixture(t, metadata) {
  const home = await temporary(t), tools = join(home, 'tools'), root = join(home, 'global modules');
  await fs.mkdir(tools); await fs.mkdir(root);
  if (metadata) await put(join(root, 'pdd/package.json'), JSON.stringify(metadata));
  await put(join(root, 'unrelated/kept'), 'unrelated npm');
  const python = join(tools, 'pdd'); await put(python, '#!/bin/sh\nprintf "Python pdd-cli\\n"\n', 0o755);
  const log = join(home, 'npm-calls');
  await put(join(tools, 'npm'), `#!/bin/sh
printf '%s\\n' "$*" >> "$S66_LOG"
if [ "$*" = 'root --global' ]; then printf '%s\\n' "$S66_ROOT"; exit 0; fi
[ "$*" = 'uninstall --global --ignore-scripts --no-audit --no-fund pdd' ] || exit 97
[ "$npm_config_ignore_scripts" = true ] && [ "$npm_config_offline" = true ] || exit 96
[ "\u0024{S66_FAIL:-0}" = 0 ] || exit 1
if [ "\${npm_config_dry_run:-false}" = true ] || [ "\${S66_NOOP:-0}" = 1 ]; then exit 0; fi
/bin/rm -r "$S66_ROOT/pdd"
printf 'npm output suppressed\\n'
`, 0o755);
  const env = { HOME: home, PATH: tools, S66_LOG: log, S66_ROOT: root };
  let output = '';
  return { home, tools, root, python, log, env, stdout: { write(text) { output += text; } }, output: () => output };
}

for (const repository of ['promptdriven/pdd_alpha', { type: 'git', url: 'git+https://github.com/promptdriven/pdd_alpha.git' }]) {
  test('S66 removes only the repository-identified old global npm Alpha', async t => {
    const f = await fixture(t, { name: 'pdd', repository });
    assert.equal(await cleanupLegacyNpm(f), true);
    assert.equal(f.output(), 'Removed old global npm pdd (promptdriven/pdd_alpha).\n');
    assert.deepEqual((await fs.readFile(f.log, 'utf8')).trim().split('\n'), ['root --global', 'uninstall --global --ignore-scripts --no-audit --no-fund pdd']);
    await assert.rejects(fs.access(join(f.root, 'pdd')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(join(f.root, 'unrelated/kept'), 'utf8'), 'unrelated npm');
    assert.equal((await execute(f.python, [], { env: f.env })).stdout, 'Python pdd-cli\n');
  });
}

test('S66 preserves Python pdd-cli when no global npm Alpha is present', async t => {
  const f = await fixture(t);
  assert.equal(await cleanupLegacyNpm(f), false); assert.equal(f.output(), '');
  assert.equal(await fs.readFile(f.log, 'utf8'), 'root --global\n');
  assert.equal((await execute(f.python, [], { env: f.env })).stdout, 'Python pdd-cli\n');
});

test('S66 does nothing when neither npm nor pdd is present', async t => {
  const f = await fixture(t); await fs.unlink(join(f.tools, 'npm')); await fs.unlink(f.python);
  assert.equal(await cleanupLegacyNpm(f), false); assert.equal(f.output(), '');
  await assert.rejects(fs.access(f.log), { code: 'ENOENT' });
});

for (const metadata of [{ name: 'pdd', repository: 'https://github.com/someone/else' }, { name: 'other', repository: 'promptdriven/pdd_alpha' }, { name: 'pdd', repository: 'https://github.com/promptdriven/pdd_alpha.evil' }]) {
  test('S66 preserves a global package without the exact legacy identity', async t => {
    const f = await fixture(t, metadata), before = await fs.readFile(join(f.root, 'pdd/package.json'));
    assert.equal(await cleanupLegacyNpm(f), false); assert.equal(f.output(), '');
    assert.deepEqual(await fs.readFile(join(f.root, 'pdd/package.json')), before);
    assert.equal(await fs.readFile(f.log, 'utf8'), 'root --global\n');
  });
}

test('S66 reports uninstall failure without retry, success output or package loss', async t => {
  const f = await fixture(t, { name: 'pdd', repository: 'promptdriven/pdd_alpha' }); f.env.S66_FAIL = '1';
  await assert.rejects(cleanupLegacyNpm(f), { code: 'legacy_npm_cleanup_failed' });
  assert.equal(f.output(), ''); await fs.access(join(f.root, 'pdd/package.json'));
  assert.equal((await fs.readFile(f.log, 'utf8')).trim().split('\n').length, 2);
});

test('verified installer retires old npm Alpha through retained absolute Node before existing setup', async t => {
  const f = await fixture(t, { name: 'pdd', repository: 'promptdriven/pdd_alpha' });
  const asset = { url: 'https://release.invalid/asset', sha256: 'a'.repeat(64), integrity: 'sha256-' + Buffer.alloc(32).toString('base64'), provenance: 'synthetic release' };
  const installer = join(f.home, 'install.sh');
  await buildBootstrap({ descriptor: { releaseId: 'R1', pddVersion: '1.0.0', alpha: asset, nodes: { 'linux-x64': { ...asset, version: '22.16.0' } } }, destination: installer });
  for (const tool of ['uname', 'openssl', 'tar', 'gzip', 'awk', 'df', 'mktemp', 'mkdir', 'chmod', 'cat', 'cp']) {
    const path = (await execute('/bin/sh', ['-c', `command -v ${tool}`])).stdout.trim(); await fs.symlink(path, join(f.tools, tool));
  }
  await put(join(f.tools, 'curl'), '#!/bin/sh\nexit 98\n', 0o755);
  await put(join(f.home, '.pdd/install/record.json'), '{"preserve":"existing install"}');
  const support = join(f.home, '.pdd/launcher/support'); await fs.mkdir(support, { recursive: true });
  await fs.symlink(process.execPath, join(support, 'node'));
  await put(join(f.home, '.pdd/launcher/pdd-launch'), '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@" > "$S66_SETUP"\n', 0o755);
  const capture = join(f.home, 'setup-argv'), cwd = join(f.home, 'project'); await fs.mkdir(cwd);
  const result = await execute('/bin/sh', [installer, '--no-phone', 'literal argument'], { cwd, env: { ...f.env, S66_SETUP: capture } });
  assert.match(result.stdout, /existing PDD runtime is retained/);
  assert.equal(result.stdout.split('Removed old global npm pdd').length, 2);
  assert.deepEqual((await fs.readFile(capture, 'utf8')).trim().split('\n'), [cwd, 'cli', 'setup', '--no-phone', 'literal argument']);
  assert.equal(await fs.readFile(join(f.home, '.pdd/install/record.json'), 'utf8'), '{"preserve":"existing install"}');
  await assert.rejects(fs.access(join(f.root, 'pdd')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(join(f.root, 'unrelated/kept'), 'utf8'), 'unrelated npm');
});


test('S66 inherited npm dry-run cannot report removal while the package remains', async t => {
  const f = await fixture(t, { name: 'pdd', repository: 'promptdriven/pdd_alpha' });
  f.env.npm_config_dry_run = 'true';
  assert.equal(await cleanupLegacyNpm(f), true);
  await assert.rejects(fs.lstat(join(f.root, 'pdd')), { code: 'ENOENT' });
  assert.equal(f.output(), 'Removed old global npm pdd (promptdriven/pdd_alpha).\n');
  assert.equal((await fs.readFile(f.log, 'utf8')).trim().split('\n').length, 2);
  assert.equal(await fs.readFile(join(f.root, 'unrelated/kept'), 'utf8'), 'unrelated npm');
  assert.equal((await execute(f.python, [], { env: f.env })).stdout, 'Python pdd-cli\n');
});

test('S66 exit-zero uninstall without removal refuses without success or retry', async t => {
  const f = await fixture(t, { name: 'pdd', repository: 'promptdriven/pdd_alpha' });
  f.env.S66_NOOP = '1';
  await assert.rejects(cleanupLegacyNpm(f), { code: 'legacy_npm_cleanup_failed' });
  assert.equal(f.output(), ''); await fs.access(join(f.root, 'pdd/package.json'));
  assert.equal((await fs.readFile(f.log, 'utf8')).trim().split('\n').length, 2);
  assert.equal(await fs.readFile(join(f.root, 'unrelated/kept'), 'utf8'), 'unrelated npm');
});
