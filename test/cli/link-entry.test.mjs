import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { temporary, runtime, pointer, put, repo } from './pkg-fixtures.mjs';

// Synthetic Main boundary: prove the actual entry leaves the default startup
// composition selected. This does not assert that D13's production self-test ran.
async function fixture(t) {
  const home = await temporary(t), selected = await runtime(home, 'selected'), current = await runtime(home, 'current');
  await pointer(home, 'current', current);
  await put(join(selected.versionRoot, 'client/src/phone/link/main.mjs'), `
    import {writeFile} from 'node:fs/promises';
    import {join} from 'node:path';
    export async function runLink(options, ports = {
      startupReady: async () => writeFile(join(process.env.HOME, 'default-startup'), 'synthetic default selected')
    }) {
      await ports.startupReady();
      console.log(JSON.stringify({options, attempt:process.env.PDD_START_ATTEMPT ?? null, cwd:process.cwd()}));
      return 23;
    }
  `);
  await put(join(current.versionRoot, 'client/src/phone/link/main.mjs'), 'throw new Error("wrong current runtime selected");\n');
  return {home, selected};
}
for (const attempt of ['original-attempt', undefined]) test(`managed Link entry preserves ${attempt ? 'the original' : 'an absent'} attempt and uses selected Main default`, async t => {
  const {home, selected} = await fixture(t), env = {HOME:home,PATH:'/usr/bin:/bin'};
  if (attempt !== undefined) env.PDD_START_ATTEMPT = attempt;
  const result = spawnSync(process.execPath, [join(repo,'launcher/link-entry.mjs'),selected.versionRoot], {env,cwd:home,encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);assert.equal(result.status,23,result.stderr);assert.equal(result.stderr,'');
  assert.deepEqual(JSON.parse(result.stdout), {options:{linkDir:join(home,'.pdd/link'),packageRoot:join(selected.versionRoot,'client')},attempt:attempt ?? null,cwd:home});
  assert.equal(await fs.readFile(join(home,'default-startup'),'utf8'),'synthetic default selected');
  await assert.rejects(fs.access(join(home,'.pdd/install/record.json')),{code:'ENOENT'});
  assert.equal(await fs.realpath(join(home,'.pdd/current')),join(home,'.pdd/versions/current'));
});
test('managed Link entry refuses invalid selected runtime before invoking Main',async t=>{
  const {home,selected}=await fixture(t);
  const record=join(selected.versionRoot,'runtime.json');
  const before=await fs.readFile(record,'utf8');
  await fs.writeFile(record,JSON.stringify({...JSON.parse(before),node:'/not-the-owned-node'}));
  const invalid=await fs.readFile(record,'utf8');
  const result=spawnSync(process.execPath,[join(repo,'launcher/link-entry.mjs'),selected.versionRoot],{env:{HOME:home,PATH:'/usr/bin:/bin',PDD_START_ATTEMPT:'unchanged'},encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,/runtime_unavailable/);assert.equal(result.stdout,'');
  await assert.rejects(fs.access(join(home,'default-startup')),{code:'ENOENT'});
  assert.equal(await fs.readFile(record,'utf8'),invalid);
});
