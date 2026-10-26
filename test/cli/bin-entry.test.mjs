import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { cases, temporary, runtime, pointer, put, repo, seed } from './pkg-fixtures.mjs';
const execute = promisify(execFile);
async function packageEntry(root, name) {
  for (const path of ['bin', 'src']) await fs.mkdir(join(root, path), { recursive: true });
  for (const file of ['versions', 'update-lock', 'install-record', 'pdd-directory']) await fs.copyFile(join(repo, 'src', `${file}.mjs`), join(root, 'src', `${file}.mjs`));
  await fs.copyFile(join(repo, 'bin/pdd.mjs'), join(root, 'bin/pdd.mjs'));
  await put(join(root, 'package.json'), '{"type":"module","version":"1.0.0"}');
  await put(join(root, 'src/pdd-cli.mjs'), `export async function runPdd(argv){process.stdout.write(JSON.stringify({argv,cwd:process.cwd(),release:${JSON.stringify(name)},node:process.execPath})+'\\n');return Number(process.env.PDD_TEST_EXIT??0);}`);
  return join(root, 'bin/pdd.mjs');
}
for (const c of await cases('bin-entry')) test(c.id, async t => {
  const home = await temporary(t), local = await packageEntry(join(home, 'fetched package'), 'local');
  const argv = c.given.argv ?? ['--version'];
  const cwd = join(home, 'chosen project'); await fs.mkdir(cwd);
  const env = { ...process.env, HOME: home, PDD_TEST_EXIT: String(c.given.childExit ?? c.given.runPddReturn ?? (c.id === 'retired-account-flags-rejected-by-current-dispatcher' ? 2 : 0)), PDD_PINNED_RUNTIME: '1' };
  if (c.id === 'uninstalled-local') {
    try { await execute(process.execPath, [local, ...argv], { cwd, env }); assert.fail('dispatcher exit 2 expected'); }
    catch (e) { assert.equal(e.code, c.expected.exitCode); assert.deepEqual(JSON.parse(e.stdout).argv, c.expected.argv); } return;
  }
  const rt = await runtime(home, c.id === 'npx-newer-than-managed' ? 'R1' : 'R2'); await packageEntry(rt.versionRoot, rt.releaseId); await pointer(home, 'current', rt);
  await seed(home);
  let invoked = local;
  if (['same-resolved-entry', 'pinned-old-controller', 'current-changes-after-selection'].includes(c.id)) {
    invoked = rt.bin;
    const next = await runtime(home, 'R5'); await fs.unlink(join(home, '.pdd/current')); await pointer(home, 'current', next);
  }
  if (c.id === 'broken-current') {
    await fs.rm(rt.versionRoot, { recursive: true });
    await assert.rejects(execute(process.execPath, [local, ...argv], { cwd, env }), e => e.code === 1 && e.stderr.includes(c.expected.code) && !e.stdout); return;
  }
  if (c.id === 'directed-signal') {
    await put(join(rt.versionRoot, 'src/pdd-cli.mjs'), "export async function runPdd(){process.stdout.write('READY\\n');await new Promise(()=>setInterval(()=>{},1000));return 0;}");
    const child = spawn(process.execPath, [local, ...argv], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); t.after(() => child.kill('SIGKILL'));
    await once(child.stdout, 'data'); const exit = once(child, 'exit'); child.kill('SIGTERM'); assert.deepEqual(await exit, [null, 'SIGTERM']); return;
  }
  let output;
  try { output = await execute(process.execPath, [invoked, ...argv], { cwd, env }); }
  catch (e) { assert.equal(e.code, c.given.childExit ?? 2); output = e; }
  const observed = JSON.parse(output.stdout);
  assert.deepEqual(observed.argv, c.expected.argv ?? argv); assert.equal(observed.cwd, cwd); assert.equal(observed.release, rt.releaseId); assert.equal(observed.node, rt.node);
});
