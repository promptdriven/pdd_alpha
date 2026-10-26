import test from 'node:test';
const hostFixtureSkip = process.platform === 'darwin' && process.env.PDD_MACOS_INTEGRATION !== '1';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vectors from '../../vectors/cli/doctor.json' with {type:'json'};
import {runDoctorCommand} from '../../src/doctor.mjs';
const capture=()=>({text:'',write(s){this.text+=s;}});
const pass={id:'runtime',state:'pass',detail:'Runtime readable.',next:null};
for(const v of vectors.cases)test(v.id,async()=>{
  const g=v.given,e=v.expected,stdout=capture(),stderr=capture(),effects=[],reads=[];
  const deps={stdout,stderr,stdinIsTTY:g.stdinIsTTY??true,
    alphaChecks:async()=>{reads.push('local');return {checks:g.alphaChecks??g.checks??[g.requiredPublicModuleMissing?{id:'modules',state:'fail',detail:'Required module missing.',next:'Reinstall the complete package.'}:g.checksFindRepairNeeded?{id:'disk',state:'fail',detail:'Repair needed.',next:'Free disk space.'}:pass],report:{versions:g.versions??{node:'22.0.0'},installPhases:g.installPhase??'checked',diskFreeBytes:g.diskFreeBytes??1000,logLines:g.safeLogLineCount?Array.from({length:g.safeLogLineCount},(_,i)=>({event:'check.completed',at:i,checkId:'runtime',state:'pass'})):g.safeLogLines??[{event:'check.completed',checkId:'runtime',state:'pass'}]}};},
    clientInstalled:g.clientInstalled??false};
  if(g.checks) {deps.clientInstalled=true;deps.clientAdapter={doctorChecks:async()=>({checks:[]})};}
  if(g.localClientChecksAvailable || g.nativeModelCapabilityCache || g.localAccountFact)deps.clientAdapter={doctorChecks:async({mode})=>{assert.ok(['report','check-only'].includes(mode));return {checks:[{id:'remote',state:'skip',detail:'Remote check excluded in local mode.',next:null}],report:{accountStates:{codex:'Auto'}}};}};
  if(g.adapterError)deps.clientAdapter={doctorChecks:async()=>{throw Error('sk-sensitive-exception');}};
  if(g.logLineKinds || g.unknownAdapterFields){deps.clientInstalled=true;deps.clientAdapter={doctorChecks:async()=>({checks:[],report:{versions:'v1',logLines:['safe status','token: sk-secret','message text: hello','pairing link: https://secret','private key: PEM','push endpoint: https://push','approval proof: secret'],unknownAdapterField:'never-dump'}})};}
  const cleanup=v.id.startsWith('cleanup-');
  if(cleanup) {
    const item={id:'legacy-pdd.service',state:'loaded',effect:'unload selected legacy unit',owned:true,actions:['unload','remove']};
    deps.cleanup={inventory:async()=>{reads.push('inventory');return [item,...(g.unprocessedItems?[{...item,id:'legacy-helper'}]:[])];},
      choose:async()=>g.choice??null,
      recheck:async()=>({owned:true,identityUnchanged:g.itemIdentityRecheck!=='changed',liveReferences:g.liveRunReferencesItem??false}),
      apply:async action=>{effects.push(action);return {ok:!g.effectResult};}};
  }
  const argv=g.argv??(cleanup?['--cleanup']:g.safeLogLines||g.logLineKinds||g.safeLogLineCount?['--report']:[]);
  const result=await runDoctorCommand(argv,deps);
  if(e.exitCode!==undefined)assert.equal(result,e.exitCode);
  if(e.usageOnStderr)assert.match(stderr.text,/Usage:/);
  if(e.checksExecuted===false || e.diagnosticReads)assert.deepEqual(reads,[]);
  if(e.stdoutJSON)assert.deepEqual(JSON.parse(stdout.text),e.stdoutJSON);
  if(e.stdout)assert.equal(stdout.text,e.stdout);
  if(e.stdoutLineCount)assert.equal(stdout.text.trim().split('\n').length,e.stdoutLineCount);
  if(e.clientChecksState)assert.match(stdout.text,/SKIP client-service: Client not installed\./);
  if(e.clientSelfCheckState)assert.match(stdout.text,/FAIL client-self-check/);
  if(e.remainingAlphaChecksReported)assert.match(stdout.text,/PASS runtime/);
  if(e.remoteCheckState)assert.match(stdout.text,/SKIP remote:/);
  if(e.optionalChecksHaveSkipReason)assert.match(stdout.text,/SKIP .*: .+/);
  if(e.rerunInteractivelyStepPresent)assert.match(stderr.text,/interactiv/);
  if(e.keepOffered)assert.match(stdout.text,/keep/);
  if(e.cleanupEffect===false || e.cleanupEffects || e.implicitRemove===false || e.cleanupEffects?.length===0)assert.deepEqual(effects,[]);
  if(e.exactSelectedUnitUnloaded) {assert.equal(effects.length,1);assert.equal(effects[0].choice,'unload');}
  if(e.automaticRepeat===false)assert.equal(effects.length,1);
  if(e.failureNextStepPresent || e.nextStepPresent)assert.match(stdout.text,/Next:/);
  if(e.printedLogLineCount)assert.equal(JSON.parse(stdout.text).logLines.length,e.printedLogLineCount);
  if(e.unsafePayloadsPrinted===false)assert.doesNotMatch(stdout.text,/sk-secret|hello|https:|PEM|never-dump/);
  assert.doesNotMatch(stdout.text+stderr.text,/sk-sensitive-exception/);
});
test('candidate self-check inspects explicit package root and fails a missing required module without writes',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pdd-doctor-'));t.after(()=>rmSync(root,{force:true,recursive:true}));
  const stdout=capture(),stderr=capture();
  writeFileSync(join(root,'package.json'),JSON.stringify({version:'1.0'}));
  mkdirSync(join(root,'bin'));writeFileSync(join(root,'bin/pdd.mjs'),'import "../src/missing.mjs";');
  const before=readdirSync(root);assert.equal(await runDoctorCommand(['--check-only'],{packageRoot:root,stdout,stderr}),1);
  assert.match(stdout.text,/FAIL modules:/);assert.deepEqual(readdirSync(root),before);
  assert.equal(readFileSync(join(root,'bin/pdd.mjs'),'utf8'),'import "../src/missing.mjs";');
});
test('one malformed client result becomes failure, other independent public checks survive',async()=>{
 const stdout=capture();assert.equal(await runDoctorCommand(['--json'],{stdout,stderr:capture(),alphaChecks:async()=>[pass],clientInstalled:true,clientAdapter:{doctorChecks:async()=>({checks:[{id:'bad',state:'pass',detail:'token: sk-secret',next:null}]})}}),1);
 const r=JSON.parse(stdout.text);assert.equal(r.checks[0].id,'runtime');assert.equal(r.checks.at(-1).id,'client-self-check');assert.doesNotMatch(stdout.text,/sk-secret/);
});

function candidate(t) {
  const root=mkdtempSync(join(tmpdir(),'pdd-candidate-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const dir of ['src','bin','docs'])mkdirSync(join(root,dir));
  writeFileSync(join(root,'package.json'),JSON.stringify({type:'module',version:'1.2.3'}));
  writeFileSync(join(root,'bin/pdd.mjs'),'import "../src/pdd-cli.mjs";');
  writeFileSync(join(root,'docs/prompting-guide.md'),'Entire synthetic guide.');
  const modules={
    'pdd-cli':'export const runPdd=()=>0,renderHelp=()=>"help";',
    'argument-parser':'export const parseArgv=()=>({local:"version"});',
    completion:'export const renderCompletion=()=>"\\n";',
    guidance:'import {readFileSync} from "node:fs";export const loadGuidance=({packageRoot})=>readFileSync(packageRoot+"/docs/prompting-guide.md","utf8");',
    'native-session':'export const launchNativeSession=()=>0;',
    'native-flags':'export const nativeArgs=()=>[];',
    'workflow-definition-loader':'export const listWorkflowDefinitions=()=>["feature","bug","small-change"].map(name=>({name}));',
    'workflow-definitions':'export {};','command-catalog':'export {};',doctor:'export {};'
  };
  for(const [name,source] of Object.entries(modules))writeFileSync(join(root,'src',name+'.mjs'),source);
  return root;
}
test('doctor imports a valid candidate and executes its public self-checks',{skip:hostFixtureSkip},async t=>{
  const packageRoot=candidate(t),stdout=capture();
  assert.equal(await runDoctorCommand(['--check-only'],{packageRoot,stdout,stderr:capture()}),0);
  assert.match(stdout.text,/PASS modules: Candidate public modules imported/);
});
for(const [name,source] of [
  ['invalid syntax','this is not JavaScript'],
  ['import failure','throw Error("sk-proj-syntheticCredential123");'],
  ['missing export','export {};'],
  ['write attempt','import {writeFileSync} from "node:fs";writeFileSync(new URL("../unexpected",import.meta.url),"changed");'],
  ['network attempt','import {get} from "node:https";get("https://example.invalid");'],
  ['stock auth read','import {readFileSync} from "node:fs";readFileSync("/synthetic/.codex/auth.json");']
])test(`candidate ${name} fails without leaking errors or producing effects`,async t=>{
  const packageRoot=candidate(t),stdout=capture(),stderr=capture();
  writeFileSync(join(packageRoot,'src/native-flags.mjs'),source);
  assert.equal(await runDoctorCommand(['--report'],{packageRoot,stdout,stderr}),1);
  assert.equal(JSON.parse(stdout.text).checks.find(c=>c.id==='modules').state,'fail');
  assert.ok(!readdirSync(packageRoot).includes('unexpected'));
  assert.doesNotMatch(stdout.text+stderr.text,/syntheticCredential|example.invalid|stock auth|Error:/);
});
test('support report positively renders structured facts and drops free text at every field',async()=>{
  const stdout=capture(),secret='sk-proj-syntheticCredential123',jwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.syntheticSignature';
  assert.equal(await runDoctorCommand(['--report'],{stdout,stderr:capture(),alphaChecks:async()=>({checks:[{...pass,detail:'arbitrary harmless prose'}],report:{
    versions:{node:'v22.1.0',codex:'1.2.3-beta',client:secret,unknown:jwt},
    installPhases:{current:'ready',previous:secret},accountStates:{codex:'full',claude:jwt},
    expiries:{codex:123,claude:secret},lastGoodAt:100,diskFreeBytes:512,
    logLines:[secret,jwt,'ordinary unproven prose',{event:'account.observed',at:99,state:'pass',checkId:'runtime',message:secret},{event:secret}],unknown:secret
  }})}),0);
  const result=JSON.parse(stdout.text);
  assert.deepEqual(result.versions,{node:'22.1.0',codex:'1.2.3'});
  assert.deepEqual(result.accountStates,{codex:'full'});assert.deepEqual(result.expiries,{codex:123});
  assert.deepEqual(result.installPhases,{current:'ready'});assert.equal(result.diskFreeBytes,512);
  assert.deepEqual(result.logLines,['account.observed at=99 check=runtime state=pass']);
  assert.doesNotMatch(stdout.text,/syntheticCredential|eyJ|arbitrary|ordinary unproven|unknown/);
});
test('actual public source candidate imports and self-checks without optional dynamic client modules',async()=>{
  const stdout=capture(),stderr=capture();
  assert.equal(await runDoctorCommand(['--check-only'],{stdout,stderr}),0,stdout.text+stderr.text);
  assert.match(stdout.text,/PASS modules:/);assert.match(stdout.text,/SKIP client-service: Client not installed/);
});
