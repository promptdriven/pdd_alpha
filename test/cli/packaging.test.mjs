import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { readInstallRecord } from '../../src/install-record.mjs';
import { cases, temporary, runtime, pointer, seed, repo, put } from './pkg-fixtures.mjs';
const execute = promisify(execFile);

test('isolated packed Alpha: public runtime, complete guidance, specifications and no lifecycle effects', async t => {
  const vectors = await cases('packaging'), home = await temporary(t), packageRoot = join(home, 'package');
  const packed = JSON.parse((await execute('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', home], { cwd: repo })).stdout)[0];
  await execute('tar', ['-xzf', join(home, packed.filename), '-C', home]);
  const { withUpdateLock } = await import(pathToFileURL(join(packageRoot, 'src/update-lock.mjs')));
  const { resolveRuntime } = await import(pathToFileURL(join(packageRoot, 'src/versions.mjs')));
  const { installLauncherSupport, provisionRecoveryService } = await import(pathToFileURL(join(packageRoot, 'src/pdd-launch.mjs')));
  const names = new Set(packed.files.map(f => f.path)), metadata = JSON.parse(await fs.readFile(join(packageRoot, 'package.json')));
  for (const c of vectors) await t.test(c.id, async () => {
    if (c.id === 'isolated-alpha-consumer') {
      assert.equal(metadata.name, '@promptdriven/pdd'); assert.equal(metadata.bin.pdd, 'bin/pdd.mjs'); assert.equal(metadata.bin['pdd-claim'], 'bin/pdd-claim.mjs'); assert.equal(metadata.type, 'module'); assert.equal(metadata.license, c.expected.license); assert.equal(metadata.engines.node, c.expected.engineFloor);
      const env = { ...process.env, HOME: home };
      const help = await execute(process.execPath, [join(packageRoot, 'bin/pdd.mjs'), '--help'], { cwd: home, env }); assert.ok(help.stdout.includes('PDD'));
      const skill = await execute(process.execPath, [join(packageRoot, 'bin/pdd.mjs'), '--skill'], { cwd: home, env });
      assert.ok(skill.stdout.includes(await fs.readFile(join(packageRoot, 'docs/prompting-guide.md'), 'utf8')));
      assert.ok(skill.stdout.includes(await fs.readFile(join(packageRoot, 'skills/pdd/references/review.md'), 'utf8'))); return;
    }
    if (['private-source-boundary', 'public-proprietary-client', 'missing-signed-client-descriptor'].includes(c.id)) {
      assert.equal([...names].some(n => /^(src\/phone\/|src\/accounts\/|src\/fleet\/|src\/updates\/|keeper\/|phone-app\/|relay\/|prompts\/(phone|keeper|accounts|fleet|updates)\/|docs\/fleet\/)/.test(n)), false);
      assert.deepEqual(metadata.dependencies ?? {}, {}); assert.equal('install' in (metadata.scripts ?? {}), false); assert.equal('postinstall' in (metadata.scripts ?? {}), false); return;
    }
    if (c.id === 'public-specification-source-retained' || c.id === 'specification-before-build') {
      for (const path of ['prompts/cli/versions.prompt.md', 'story/cli/VERSIONS.md', 'vectors/cli/versions.json', 'launcher/pdd-launch', 'launcher/native/linux-x64/pdd-lock', 'bin/pdd-claim.mjs', 'bin/pdd-flock', 'launcher/native/linux-x64/pdd-flock', 'src/workflow-flock.c', 'launcher/build-claims.mjs', 'install.sh', 'examples/ticket-status/vectors/status-labels.json']) assert.ok(names.has(path), path);
      return;
    }
    if (c.id === 'public-recovery-service' || c.id === 'recovery-service-text-stable') {
      const isolated = join(home, c.id); await fs.mkdir(isolated); const rt = await runtime(isolated);
      for (const directory of ['src', 'launcher']) await fs.cp(join(packageRoot, directory), join(rt.versionRoot, directory), { recursive: true });
      await pointer(isolated, 'current', rt); assert.deepEqual(await resolveRuntime({ home: isolated, versionRoot: rt.versionRoot }), rt); let activations = 0;
      const ports = { activateRecoveryService: async () => { activations++; } };
      const first = await withUpdateLock({ home: isolated }, async lease => {
        assert.equal((await installLauncherSupport({ home: isolated, runtime: rt, lease })).code, null);
        return provisionRecoveryService({ home: isolated, runtime: rt, lease }, ports);
      });
      assert.equal(first.code, null); const before = await fs.stat(first.files[0]);
      const again = await withUpdateLock({ home: isolated }, lease => provisionRecoveryService({ home: isolated, runtime: rt, lease }, ports));
      assert.equal(again.changed, false); assert.equal((await fs.stat(first.files[0])).mtimeMs, before.mtimeMs); assert.equal(activations, 2);
      const recovered = await execute(join(isolated, '.pdd/launcher/pdd-launch'), ['recover'], { env: { ...process.env, HOME: isolated } }); assert.equal(recovered.stdout.trim(), 'ready'); return;
    }
    if (c.id === 'unknown-control-state') {
      const isolated = join(home, c.id); await put(join(isolated, '.pdd/install/record.json'), JSON.stringify({ v: 1, rev: 1, transaction: { phase: c.given.controlState }, staging: {}, starts: {}, rejected: {}, reports: [], futureField: 'preserve' }));
      const read = await readInstallRecord({ home: isolated }); assert.equal(read.code, 'recovery_required'); assert.equal(read.value.futureField, 'preserve'); return;
    }
    if (c.id === 'machine-settings-survive-update') {
      const isolated = join(home, c.id); await seed(isolated, { machineToolAccounts: c.given.machineToolAccounts, projectBaseFolder: c.given.projectBaseFolder, toolDefaults: c.given.toolDefaults });
      const before = await fs.readFile(join(isolated, '.pdd/install/record.json')); await readInstallRecord({ home: isolated }); assert.deepEqual(await fs.readFile(join(isolated, '.pdd/install/record.json')), before); return;
    }
    // This source checkout has no registry/deploy lifecycle. Release CI, review,
    // lab and manual gates remain the release owner's supplied evidence; packing
    // is an offline preparation operation and cannot grant publication authority.
    assert.equal(metadata.private, true); assert.deepEqual(Object.keys(metadata.scripts), ['test']);
  });
  await t.test('packed claim entry retains kernel exclusion across exec and releases on death', async t => {
    const isolated = join(home, 'claim home'), cwd = join(home, 'claim project');
    await fs.mkdir(isolated); await fs.mkdir(cwd);
    const marker = join(isolated, 'started.json'), collision = join(isolated, 'collision');
    const script = join(isolated, 'native-stand-in.mjs');
    await put(script, "import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify({cwd:process.cwd(),args:process.argv.slice(3)}));setInterval(()=>{},1000);\n");
    const entry = join(packageRoot, 'bin/pdd-claim.mjs'), key = 'codex:12345678-1234-4123-8123-123456789abc';
    const env = { ...process.env, HOME: isolated };
    const holder = spawn(process.execPath, [entry, key, '--', process.execPath, script, marker, 'literal space', '$(touch forbidden)'], { cwd, env, stdio: 'ignore' });
    const exited = once(holder, 'exit');
    t.after(async () => { if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGTERM'); await exited; });
    const until = Date.now() + 5000;
    while (true) {
      try { await fs.access(marker); break; }
      catch (e) { if (e.code !== 'ENOENT' || Date.now() > until || holder.exitCode !== null) throw e; await delay(10); }
    }
    assert.deepEqual(JSON.parse(await fs.readFile(marker)), { cwd, args: ['literal space', '$(touch forbidden)'] });
    const lock = join(isolated, '.pdd/claims', key.replace(':', '-') + '.lock'), inode = (await fs.stat(lock)).ino;
    const command = "require('node:fs').writeFileSync(process.argv[1],'ran')";
    await assert.rejects(execute(process.execPath, [entry, key, '--', process.execPath, '-e', command, collision], { cwd, env }), e => e.code === 75 && e.stderr.includes('already runs here'));
    await assert.rejects(fs.access(collision), { code: 'ENOENT' });
    holder.kill('SIGTERM'); await exited;
    await execute(process.execPath, [entry, key, '--', process.execPath, '-e', command, collision], { cwd, env });
    assert.equal(await fs.readFile(collision, 'utf8'), 'ran');
    assert.equal((await fs.stat(lock)).ino, inode);
    await assert.rejects(fs.access(join(cwd, 'forbidden')), { code: 'ENOENT' });
  });

});
