import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {runPdd} from '../../src/pdd-cli.mjs';
import {resolveRuntime} from '../../src/versions.mjs';

const capture=()=>({text:'',write(value){this.text+=value;}});
async function fixture(t,source){
 const home=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'installed-setup-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const versionRoot=join(home,'.pdd/versions/test'),entry=join(versionRoot,'client/src/fleet/setup.mjs');
 await fs.mkdir(versionRoot,{recursive:true,mode:0o700});
 if(source!==undefined){await fs.mkdir(join(versionRoot,'client/src/fleet'),{recursive:true,mode:0o700});await fs.writeFile(entry,source,{mode:0o600});}
 const runtime={versionRoot},stdout=capture(),stderr=capture(),signal=new AbortController().signal;
 let active=false,calls=[];
 const deps={home,packageRoot:versionRoot,stdout,stderr,stdin:Readable.from(['input']),signal,
  // Explicit synthetic public owners isolate the installed command boundary.
  setupModules:{versions:{resolveRuntime:async()=>runtime},
   lock:{withUpdateLock:async(_,action)=>{active=true;try{return await action({});}finally{active=false;await fs.writeFile(join(home,'released'),'yes');}}},
   herdrRuntime:{recordHerdrRuntime:async()=>runtime},
   launcher:{installLauncherSupport:async()=>{assert.ok(active);calls.push('support');return {code:null};},provisionRecoveryService:async()=>{assert.ok(active);calls.push('service');return {code:null};}}},
  workflowHerdrBoot:{ensureHerdrInstalled:async()=>({state:'ready',code:null,executable:process.execPath})}};
 return {home,versionRoot,entry,stdout,stderr,deps,calls};
}

test('installed setup awaits its fixed private export after lease release with only the agreed context',async t=>{
 const f=await fixture(t,`import {readFile} from 'node:fs/promises';
export async function runSetupCommand(argv,options){
 const released=await readFile(options.home+'/released','utf8');
 let input='';for await(const chunk of options.stdin)input+=chunk;
 await new Promise(resolve=>setTimeout(resolve,10));
 options.stdout.write(JSON.stringify({argv,keys:Object.keys(options).sort(),home:options.home,linkDir:options.linkDir,input,released,aborted:options.signal.aborted}));return 7;
}`);
 assert.equal(await runPdd(['setup','--no-phone'],f.deps),7);
 assert.deepEqual(JSON.parse(f.stdout.text),{argv:['--no-phone'],keys:['home','linkDir','signal','stderr','stdin','stdout'],home:f.home,linkDir:join(f.home,'.pdd/link'),input:'input',released:'yes',aborted:false});
 assert.deepEqual(f.calls,['support','service']);assert.equal(f.stderr.text,'');
});

test('Alpha without a private directory keeps public setup success and private-command refusal',async t=>{
 const f=await fixture(t);
 assert.equal(await runPdd(['setup'],f.deps),0);assert.match(f.stdout.text,/Public recovery service ready/);
 assert.equal(await runPdd(['accounts'],f.deps),1);assert.match(f.stderr.text,/this needs the fleet client/);
 assert.equal(await fs.stat(join(f.versionRoot,'client')).then(()=>true,()=>false),false);
});

for(const kind of ['missing-entry','missing-export','syntax','symlink','hardlink','writable'])test(`installed setup refuses ${kind} instead of reporting Alpha success`,async t=>{
 const f=await fixture(t,'export async function runSetupCommand(){throw Error("must not execute");}');
 if(kind==='missing-entry')await fs.unlink(f.entry);
 if(kind==='missing-export')await fs.writeFile(f.entry,'export const other=1;');
 if(kind==='syntax')await fs.writeFile(f.entry,'this is invalid syntax');
 if(kind==='symlink'){await fs.rename(join(f.versionRoot,'client'),join(f.home,'foreign'));await fs.symlink(join(f.home,'foreign'),join(f.versionRoot,'client'));}
 if(kind==='hardlink')await fs.link(f.entry,join(f.home,'retained'));
 if(kind==='writable')await fs.chmod(f.entry,0o666);
 assert.equal(await runPdd(['setup'],f.deps),1);assert.equal(f.stdout.text,'');assert.match(f.stderr.text,/this needs the fleet client/);assert.doesNotMatch(f.stderr.text,/must not execute|SyntaxError/);
});

test('help never imports installed private setup and explicit client retains precedence',async t=>{
 const f=await fixture(t,'throw Error("must not import");');
 assert.equal(await runPdd(['--help'],f.deps),0);assert.deepEqual(f.calls,[]);
 let count=0;f.stdout.text='';
 assert.equal(await runPdd(['setup'],{...f.deps,clientAdapter:{runSetupCommand:async(argv,ports)=>{count++;assert.deepEqual(argv,[]);assert.equal(ports.stdout,f.stdout);return 3;}}}),3);
 assert.equal(count,1);assert.equal(f.stderr.text,'');
});

for(const outcome of ['throw Error("private failure")','return 999','return "0"'])test(`installed setup ${outcome} is unconfirmed without retry`,async t=>{
 const f=await fixture(t,`export async function runSetupCommand(argv,{stdout}){stdout.write('once');${outcome};}`);
 assert.equal(await runPdd(['setup'],f.deps),1);assert.equal(f.stdout.text,'once');assert.match(f.stderr.text,/unconfirmed/);assert.doesNotMatch(f.stderr.text,/private failure|ready/);
});

test('real runtime layout accepts a writable ancestor but private setup refuses before import',async t=>{
 for(const ancestor of ['root','versions','pdd','home']){
  const f=await fixture(t,`throw Error('private module must never be imported');`);
  // A marker at module evaluation proves refusal occurs before import/effects.
  const marker=join(f.home,'imported');
  await fs.writeFile(f.entry,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');export async function runSetupCommand(){return 7;}`);
  const node=join(f.home,'.pdd/tools/node/22.0.0/bin/node'),bin=join(f.versionRoot,'bin/pdd.mjs');
  await fs.mkdir(join(f.home,'.pdd/tools/node/22.0.0/bin'),{recursive:true,mode:0o700});await fs.mkdir(join(f.versionRoot,'bin'),{mode:0o700});
  await fs.writeFile(node,'synthetic layout executable',{mode:0o700});await fs.writeFile(bin,'// layout only');
  await fs.writeFile(join(f.versionRoot,'package.json'),JSON.stringify({type:'module',version:'1.0.0'}));
  await fs.writeFile(join(f.versionRoot,'runtime.json'),JSON.stringify({v:1,releaseId:'test',versionRoot:f.versionRoot,node,bin,pddVersion:'1.0.0',alphaDigest:'synthetic',nodeVersion:'22.0.0',clientDigest:null,credentialHelper:null}));
  const target={root:f.versionRoot,versions:join(f.home,'.pdd/versions'),pdd:join(f.home,'.pdd'),home:f.home}[ancestor];
  await fs.chmod(target,0o770);
  const runtime=await resolveRuntime({home:f.home,versionRoot:f.versionRoot});assert.equal(runtime.versionRoot,f.versionRoot);
  f.deps.setupModules.versions={resolveRuntime};f.deps.setupModules.herdrRuntime={recordHerdrRuntime:async()=>runtime};
  assert.equal(await runPdd(['setup'],f.deps),1,ancestor);assert.match(f.stderr.text,/this needs the fleet client/);
  assert.equal(f.stdout.text,'');assert.equal(await fs.stat(marker).then(()=>true,()=>false),false);
  assert.equal((await fs.stat(target)).mode&0o777,0o770,'refusal does not repair permissions');
 }
});
