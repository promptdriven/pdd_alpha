import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildBootstrap } from '../../launcher/build-bootstrap.mjs';
import { temporary, put } from './pkg-fixtures.mjs';

const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const asset = {url:'https://release.invalid/artifact', sha256:'a'.repeat(64), integrity:'sha512-synthetic', provenance:'synthetic-offline'};
const descriptor = {releaseId:'migration-test', pddVersion:'1.0.0', alpha:asset, nodes:{'linux-x64':{...asset, version:'22.16.0'}}};

// This synthetic script exercises the installer's orchestration only. The Mac
// owner's actual migration body is never applied to a developer or lab home.
const migration = `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/calls"
case "$1" in
  --dry-run) [ "$#" = 1 ] || exit 97; printf '%s\\n' 'synthetic offline plan'; exit "$DRY_CODE" ;;
  --apply)
    [ "$#" = 3 ] && [ "$2" = --backup-dir ] || exit 98
    case "$3" in "$HOME/.pdd/migrate/"*) ;; *) exit 99 ;; esac
    if [ "$APPLY_CODE" != 0 ]; then printf '%s\\n' "$3/log.txt" >&2; fi
    exit "$APPLY_CODE" ;;
  *) exit 96 ;;
esac
`;

async function fixture(t, {dry=0, apply=0, candidate=true}={}) {
  const home = await temporary(t), installer = join(home,'install.sh');
  await buildBootstrap({descriptor, destination:installer});
  const original = await fs.readFile(installer,'utf8');
  const start = original.indexOf('pdd_r_line_move=');
  const end = original.indexOf('\npdd_trust_descriptor=',start);
  assert.ok(start > 0 && end > start);
  await fs.writeFile(installer, original.slice(0,start) + 'pdd_r_line_move=' + quote(migration) + original.slice(end));
  await put(join(home,'.pdd/launcher/pdd-launch'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/continued"\n',0o700);
  await fs.mkdir(join(home,'.pdd/current'));
  if (candidate) await fs.mkdir(join(home,'pocket'));
  await put(join(home,'.codex/keep'),'native credentials stand-in',0o600);
  const before = await fs.stat(join(home,'.codex/keep'));
  return {home, run: async input => {
    const result = spawnSync('/bin/sh',[installer,'--no-phone'],{input,encoding:'utf8',timeout:10000,env:{HOME:home,PATH:'/usr/bin:/bin',DRY_CODE:String(dry),APPLY_CODE:String(apply)}});
    assert.equal(result.error,undefined);
    assert.equal(await fs.readFile(join(home,'.codex/keep'),'utf8'),'native credentials stand-in');
    const after = await fs.stat(join(home,'.codex/keep'));
    assert.deepEqual([after.ino,after.mode,after.mtimeMs],[before.ino,before.mode,before.mtimeMs]);
    const read = async name => fs.readFile(join(home,name),'utf8').catch(e => {if(e.code==='ENOENT')return null;throw e;});
    return {...result,calls:await read('calls'),continued:await read('continued')};
  }};
}

test('migration dry-run 0 asks once and apply 0 continues existing setup with original arguments',async t=>{
  const f=await fixture(t), r=await f.run('\n');
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stdout.split('Move off the old PDD build? [Y]').length,2);
  assert.match(r.calls,/^--dry-run\n--apply --backup-dir /);
  assert.ok(r.calls.includes(f.home+'/.pdd/migrate/'));
  assert.equal(r.continued,'cli\nsetup\n--no-phone\n');
});
test('migration dry-run 2 continues without consent or apply',async t=>{
  const f=await fixture(t,{dry:2}),r=await f.run('');
  assert.equal(r.status,0,r.stderr); assert.equal(r.calls,'--dry-run\n');
  assert.ok(!r.stdout.includes('Move off')); assert.ok(r.continued);
});
for(const dry of [1,3])test(`migration dry-run ${dry} stops before consent, apply and setup`,async t=>{
  const f=await fixture(t,{dry}),r=await f.run('yes\n');
  assert.equal(r.status,1);assert.equal(r.calls,'--dry-run\n');assert.equal(r.continued,null);
  assert.match(r.stderr,/Old-build move refused/);assert.ok(!r.stdout.includes('Move off'));
});
test('migration apply 1 preserves failure and log path and stops setup',async t=>{
  const f=await fixture(t,{apply:1}),r=await f.run('yes\n');
  assert.equal(r.status,1);assert.equal(r.continued,null);assert.match(r.calls,/--apply --backup-dir/);
  assert.ok(r.stderr.includes(f.home+'/.pdd/migrate/'));assert.match(r.stderr,/log\.txt/);
});
for(const input of ['no\n',''])test(`migration ${input ? 'decline' : 'EOF'} never applies or starts setup`,async t=>{
  const f=await fixture(t),r=await f.run(input);
  assert.equal(r.status,1);assert.equal(r.calls,'--dry-run\n');assert.equal(r.continued,null);
});
test('unrelated personal pdd does not trigger migration and retains its bytes',async t=>{
  const f=await fixture(t,{candidate:false});
  await put(join(f.home,'.local/bin/pdd'),'#!/bin/sh\n# personal program\n',0o755);
  const r=await f.run('');assert.equal(r.status,0,r.stderr);assert.equal(r.calls,null);assert.ok(r.continued);
  assert.equal(await fs.readFile(join(f.home,'.local/bin/pdd'),'utf8'),'#!/bin/sh\n# personal program\n');
});
test('generated bootstrap embeds the shipped migration bytes exactly without executing them',async t=>{
  const home=await temporary(t),installer=join(home,'installer');
  await buildBootstrap({descriptor,destination:installer});
  const source=await fs.readFile(installer,'utf8'),start=source.indexOf('pdd_r_line_move='),end=source.indexOf('\npdd_trust_descriptor=',start);
  const r=spawnSync('/bin/sh',['-c',source.slice(start,end)+'\nprintf "%s" "$pdd_r_line_move"'],{maxBuffer:1024*1024});
  assert.equal(r.status,0,r.stderr.toString());
  assert.deepEqual(r.stdout,await fs.readFile(new URL('../../launcher/migrate-r-line.sh',import.meta.url)));
});
for (const target of ['../../pocket/bin/pdd','absolute']) test(`old ${target === 'absolute' ? 'absolute' : 'relative'} pocket wrapper triggers dry run without a pocket directory`,async t=>{
  const f=await fixture(t,{candidate:false,dry:2});
  await fs.mkdir(join(f.home,'.local/bin'),{recursive:true});
  await fs.symlink(target === 'absolute' ? join(f.home,'pocket/bin/pdd') : target,join(f.home,'.local/bin/pdd'));
  const r=await f.run('');assert.equal(r.status,0,r.stderr);assert.equal(r.calls,'--dry-run\n');assert.ok(r.continued);
  assert.equal(await fs.readlink(join(f.home,'.local/bin/pdd')),target === 'absolute' ? join(f.home,'pocket/bin/pdd') : target);
});
