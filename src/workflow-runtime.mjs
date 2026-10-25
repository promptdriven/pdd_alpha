// Generated from prompts/cli/workflow-runtime.prompt.md (sha256: 43763a5df7a0ee662509b7078ab979440512d91afafec16d1055ecb215722997).
import * as nodeFs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const fsOf = p => p.fs ?? nodeFs;
const hash = b => createHash('sha256').update(b).digest('hex');
const fail = code => {throw Object.assign(new Error(code),{code});};
const runtimeValid = r => r?.v === 1 && typeof r.releaseId === 'string' && r.releaseId.length > 0 &&
  ['versionRoot','node','bin'].every(k=>typeof r[k] === 'string' && isAbsolute(r[k])) && r.bin === join(r.versionRoot,'bin','pdd.mjs') &&
  r.packageRoot === r.versionRoot && ['pddVersion','alphaDigest','nodeVersion'].every(k=>typeof r[k] === 'string' && r[k].length > 0) &&
  (r.clientDigest === null || typeof r.clientDigest === 'string') && (r.credentialHelper === null || isAbsolute(r.credentialHelper ?? ''));
async function syncDir(fs,path) {const h=await fs.open(path,'r');try{await h.sync();}finally{await h.close();}}
async function durable(fs,path,bytes) {
  const h=await fs.open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
  try {await h.writeFile(bytes);await h.sync();} finally {await h.close();}
  await syncDir(fs,dirname(path));
}
async function ordinary(fs,path) {
  const h=await fs.open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {const a=await h.stat();if(!a.isFile()||a.nlink !== 1)fail('frozen_input_invalid');const b=await h.readFile();const z=await h.stat();if(a.size!==z.size||a.mtimeMs!==z.mtimeMs||a.ctimeMs!==z.ctimeMs)fail('frozen_input_invalid');return b;}finally{await h.close();}
}
async function executableRuntime(runtime,p) {
  if(!runtimeValid(runtime))return {ok:false,code:'runtime_missing'};
  try {const fs=fsOf(p);await fs.access(runtime.node,constants.X_OK);await fs.access(runtime.bin,constants.R_OK);if(runtime.credentialHelper)await fs.access(runtime.credentialHelper,constants.X_OK);return {ok:true,code:null};}
  catch{return {ok:false,code:'runtime_missing'};}
}
function definitionValid(d) {
  return d && Array.isArray(d.files) && Array.isArray(d.stages) && d.files.every(f=>typeof f.path === 'string' && typeof f.content === 'string' && hash(f.content)===f.sha256) &&
    hash(JSON.stringify({name:d.name,version:d.version,stages:d.stages,files:d.files.map(({path,sha256})=>({path,sha256}))})) === d.digest;
}
export async function freezeWorkflowInputs({runDir,guidance,definition,runtime,seed},ports={}) {
  const fs=fsOf(ports);
  if(seed&&Object.keys(seed).some(k=>!['repository','issue','baseRef','baseSha','sourceRoot','root','project','launchSelection'].includes(k)))fail('frozen_input_invalid');
  if(typeof guidance!=='string'||!guidance.length||!definitionValid(definition)||!seed||!seed.issue||!Number.isSafeInteger(seed.issue.number)||seed.issue.number<1||
    !['repository','baseRef','baseSha','sourceRoot','root'].every(k=>typeof seed[k] === 'string' && seed[k].length>0)||!['sourceRoot','root'].every(k=>isAbsolute(seed[k])))fail('frozen_input_invalid');
  // Runtime is caller verified; preserve all descriptor additions and only add local observations.
  const savedRuntime={...runtime,packageRoot:runtime.packageRoot??runtime.versionRoot,
    codexVersion:runtime.codexVersion??ports.toolVersions?.codex??null,claudeVersion:runtime.claudeVersion??ports.toolVersions?.claude??null,
    herdrVersion:runtime.herdrVersion??ports.toolVersions?.herdr??null,cacheSchema:runtime.cacheSchema??null};
  if(!runtimeValid(savedRuntime))fail('runtime_missing');
  const dir=join(runDir,'frozen');
  await fs.mkdir(dir,{mode:0o700}); // Exclusive: interrupted freezes are retained, never overwritten.
  await syncDir(fs,runDir);
  const sources=[{source:'guidance',content:guidance},{source:'seed',content:JSON.stringify(seed)},...definition.files.map(f=>({source:join(definition.root,f.path),content:f.content}))];
  const files=[];
  for(let i=0;i<sources.length;i++){
    const s=sources[i],path=`input-${i}.txt`;await durable(fs,join(dir,path),s.content);files.push({path,source:s.source,sha256:hash(s.content)});
  }
  const record={v:1,runtime:savedRuntime,seed:structuredClone(seed),definition:structuredClone(definition),files};
  const manifest=JSON.stringify(record)+'\n';await durable(fs,join(dir,'manifest.json'),manifest);
  await durable(fs,join(dir,'complete.json'),JSON.stringify({sha256:hash(manifest)})+'\n');
  return record;
}
export async function readWorkflowRuntime({runDir},ports={}) {
  const fs=fsOf(ports),dir=join(runDir,'frozen');
  try {
    const info=await fs.lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())fail('frozen_input_invalid');
    const manifest=await ordinary(fs,join(dir,'manifest.json')),complete=JSON.parse(await ordinary(fs,join(dir,'complete.json')));
    if(hash(manifest)!==complete.sha256)fail('frozen_input_invalid');
    const record=JSON.parse(manifest);
    if(record.v!==1||!runtimeValid(record.runtime)||!definitionValid(record.definition)||!Array.isArray(record.files)||record.files.length !== record.definition.files.length+2)fail('frozen_input_invalid');
    for(let i=0;i<record.files.length;i++){
      const f=record.files[i];if(f.path!==`input-${i}.txt`||hash(await ordinary(fs,join(dir,f.path)))!==f.sha256)fail('frozen_input_invalid');
    }
    if(hash(JSON.stringify(record.seed))!==record.files[1].sha256||record.definition.files.some((f,i)=>f.sha256!==record.files[i+2].sha256))fail('frozen_input_invalid');
    return record;
  } catch {fail('frozen_input_invalid');}
}
export async function checkWorkflowRuntime({runDir,releasePolicy=null},ports={}) {
  let record;try{record=await readWorkflowRuntime({runDir},ports);}catch{return {ok:false,code:'frozen_input_invalid'};}
  // An upgrade is selected only by the strict controller journal, never an intent or status file.
  let runtime=record.runtime;
  if(ports.readWorkflowJournal){try{const j=await ports.readWorkflowJournal({runDir});runtime=j.state?.runtime??runtime;}catch{return {ok:false,code:'frozen_input_invalid'};}}
  const check=await executableRuntime(runtime,ports);if(!check.ok)return check;
  if(releasePolicy?.blocked?.includes(runtime.releaseId))return {ok:false,code:'runtime_blocked',next:'Upgrade run'};
  return check;
}
export async function listWorkflowRuntimeReferences({entries},ports={}) {
  let complete=Array.isArray(entries);const references=[];
  for(const entry of entries??[]) {
    try {
      if(!ports.readWorkflowJournal)throw Error();
      const before=await ports.readWorkflowJournal({runDir:entry.runDir});
      if(!['completed','failed'].includes(before.state?.controlState)){
        const frozen=await readWorkflowRuntime({runDir:entry.runDir},ports);
        references.push({runId:entry.runId,runDir:entry.runDir,runtime:before.state.runtime??frozen.runtime});
      }
      for(const intent of await readUpgradeIntents(entry.runDir,ports)) {
        if(!committed(before.state,intent))for(const runtime of [intent.oldRuntime,intent.newRuntime])references.push({runId:entry.runId,runDir:entry.runDir,runtime,pendingUpgrade:true});
      }
      const after=await ports.readWorkflowJournal({runDir:entry.runDir});if(before.seq!==after.seq||!isDeepStrictEqual(before.state,after.state))complete=false;
    } catch {complete=false;}
  }
  return {complete,references};
}
async function readUpgradeIntents(runDir,p) {
  const fs=fsOf(p),dir=join(runDir,'runtime-upgrades');let names;
  try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const out=[];for(const name of names.sort()){if(!/^[0-9a-f-]{36}\.json$/.test(name))throw Error('invalid intent');const v=JSON.parse(await ordinary(fs,join(dir,name)));if(!Number.isSafeInteger(v.expectedRev)||!runtimeValid(v.oldRuntime)||!runtimeValid(v.newRuntime))throw Error('invalid intent');out.push(v);}return out;
}
function committed(state,intent){return (state.upgrades??[]).some(u=>u.upgradeId===intent.upgradeId&&u.event==='upgrade.committed'&&isDeepStrictEqual(u.newRuntime,intent.newRuntime));}
export async function upgradeWorkflowRuntime({runDir,expectedRev,target},ports={}) {
  target={...target,packageRoot:target?.packageRoot??target?.versionRoot,codexVersion:target?.codexVersion??ports.toolVersions?.codex??null,claudeVersion:target?.claudeVersion??ports.toolVersions?.claude??null,herdrVersion:target?.herdrVersion??ports.toolVersions?.herdr??null,cacheSchema:target?.cacheSchema??null};
  if(typeof ports.withUpgradeGuard!=='function')return {state:'refused',code:'unsupported'};
  if(!Number.isSafeInteger(expectedRev)||expectedRev<1)return {state:'refused',code:'stale_decision'};
  try{return await ports.withUpgradeGuard({runDir},async ({state,appendUpgrade})=>{
    if(typeof appendUpgrade!=='function')return {state:'refused',code:'unsupported'};
    const intents=await readUpgradeIntents(runDir,ports);
    const prior=intents.find(i=>i.expectedRev===expectedRev);
    if(prior){
      if(!isDeepStrictEqual(prior.newRuntime,target))return {state:'refused',code:'upgrade_conflict'};
      return committed(state,prior)?{state:'upgraded',code:null}:{state:'recovery_required',code:'upgrade_uncertain'};
    }
    if(state.rev!==expectedRev)return {state:'refused',code:'stale_decision'};
    if(!['waiting_person','WAIT','waiting_agent'].includes(state.controlState)||state.stopped!==true||state.controllerLive||state.stageLive||state.attached||state.pendingEffect||state.pending?.backend?.live||state.unresolvedEffects?.length||state.pendingSend||state.pendingLaunch||state.pendingCleanup)return {state:'refused',code:'run_not_stopped'};
    const check=await executableRuntime(target,ports);if(!check.ok)return {state:'refused',code:check.code};
    if(ports.releasePolicy?.blocked?.includes(target.releaseId))return {state:'refused',code:'runtime_blocked'};
    await readWorkflowRuntime({runDir},ports);
    if(ports.requiresDifferentContext?.(target,state))return {state:'refused',code:'frozen_input_invalid'};
    const fs=fsOf(ports),dir=join(runDir,'runtime-upgrades');await fs.mkdir(dir,{recursive:true,mode:0o700});await syncDir(fs,runDir);
    const intent={upgradeId:randomUUID(),expectedRev,oldRuntime:state.runtime,newRuntime:target};
    await durable(fs,join(dir,`${intent.upgradeId}.json`),JSON.stringify(intent)+'\n');
    await appendUpgrade({event:'upgrade.intent',...intent});
    await appendUpgrade({event:'upgrade.committed',...intent});
    return {state:'upgraded',code:null};
  });}catch{return {state:'recovery_required',code:'upgrade_uncertain'};}
}
