import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const bin=fileURLToPath(new URL('../bin/pdd.mjs',import.meta.url));

test('actual public native entry uses explicit full access for both agents with inherited input/env and real exit',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'pdd-full-access-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const home=join(root,'home'),cwd=join(root,'project \"quoted\".with spaces\\name=chosen'),native=join(root,'native');for(const d of [home,cwd,native])mkdirSync(d);
 writeFileSync(join(native,'package.json'),'{"type":"commonjs"}\n');
 const script=`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);if(process.argv[1].endsWith('/codex')){if(!args.includes('--no-daemon')||!args.includes('check_for_update_on_startup=false')){process.stderr.write('Background server incompatible feature settings');process.exit(31);}const setting=args[args.lastIndexOf('-c')+1]??'';let trusted=false;try{const suffix='={trust_level=\"trusted\"}}';trusted=setting.startsWith('projects={')&&setting.endsWith(suffix)&&JSON.parse(setting.slice(10,-suffix.length))===process.cwd();}catch{}if(!trusted){process.stderr.write('Trust this folder');process.exit(32);}}const result=JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),input:fs.readFileSync(0,'utf8'),setting:process.env.NATIVE_SETTING_EXAMPLE});if(process.env.NATIVE_RESULT_FILE)fs.writeFileSync(process.env.NATIVE_RESULT_FILE,result);else process.stdout.write(result);process.exit(Number(process.env.FIXTURE_EXIT||0));\n`;
 for(const agent of ['codex','claude'])writeFileSync(join(native,agent),script,{mode:0o755});
 const request='Summarize guide only; $(touch no-shell-effect)';
 for(const agent of ['codex','claude']){
  const resultFile=join(root,`${agent}-result.json`);
  const r=spawnSync(process.execPath,[bin,'session','--agent',agent,request],{cwd,env:{...process.env,HOME:home,PATH:native,NATIVE_SETTING_EXAMPLE:'ordinary',NATIVE_RESULT_FILE:resultFile,FIXTURE_EXIT:agent==='claude'?'7':'0'},input:'native terminal input\n',encoding:'utf8',timeout:5000});
  assert.equal(r.status,agent==='claude'?7:0,r.stderr);assert.equal(r.stderr,'');const actual=JSON.parse(readFileSync(resultFile,'utf8'));
  assert.equal(actual.args.length,agent==='codex'?8:2);assert.deepEqual(actual.args.slice(0,-1),agent==='codex'?['--no-daemon','--dangerously-bypass-approvals-and-sandbox','--dangerously-bypass-hook-trust','-c','check_for_update_on_startup=false','-c',`projects={${JSON.stringify(cwd)}={trust_level="trusted"}}`]:['--dangerously-skip-permissions']);
  assert.ok(actual.args.at(-1).includes('Read the ENTIRE Prompting guide'));assert.ok(actual.args.at(-1).includes(request));assert.equal(actual.cwd,cwd);assert.equal(actual.input,'native terminal input\n');assert.equal(actual.setting,'ordinary');
 }
 assert.deepEqual(readdirSync(home),[]);assert.deepEqual(readdirSync(cwd),[]);
});
