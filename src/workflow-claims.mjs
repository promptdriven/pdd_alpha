// Generated from prompts/cli/workflow-claims.prompt.md (sha256: 3d61ef638c783860141df891b7dd91f8f8da4a7b3b980e3f41b129f4bed046c4).
import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const contexts = new AsyncLocalStorage();
const claims = new WeakMap();
const validGeneration = n => Number.isSafeInteger(n) && n > 0;
const helperOf = p => p.flockHelper ?? fileURLToPath(new URL('../bin/pdd-flock', import.meta.url));
const error = code => Object.assign(new Error(code), {code});

async function acquire(path, ports = {}) {
  if (!isAbsolute(path ?? '')) return {state:'unknown',code:'unsupported'};
  if (ports.acquireLock) return ports.acquireLock({path});
  if (!['linux','darwin'].includes(process.platform)) return {state:'unknown',code:'unsupported'};
  const fs = ports.fs ?? {mkdir,access};
  try { await fs.access(helperOf(ports), 1); await fs.mkdir(dirname(path), {recursive:true,mode:0o700}); }
  catch { return {state:'unknown',code:'unsupported'}; }
  return new Promise(resolve => {
    const child = spawn(helperOf(ports), ['hold',path], {stdio:['pipe','pipe','ignore']});
    let settled = false, output = '';
    const timer=setTimeout(()=>{child.kill();done({state:'unknown',code:'unsupported'});},2000);
    const done = v => {if (!settled) {settled = true;clearTimeout(timer); resolve(v);}};
    child.stdin.on('error',()=>{});
    child.on('error',()=>done({state:'unknown',code:'unsupported'}));
    child.on('exit',code=>done({state:code === 75 ? 'busy':'unknown',code:code === 75 ? 'busy':'unsupported'}));
    child.stdout.on('data',b=>{
      output += b;
      if (output === 'held\n') done({state:'owned',release:()=>new Promise(r=>{if(child.exitCode !== null || child.signalCode !== null) return r(); child.once('exit',r);child.stdin.end();})});
    });
  });
}
export async function withWorkflowLock({path, busyCode}, action, ports = {}) {
  const owned = contexts.getStore();
  if (owned?.has(path)) return action();
  const lock = await acquire(path, ports);
  if (lock.state !== 'owned') throw error(lock.state === 'busy' ? busyCode ?? (path.endsWith('controller.lock') || path.endsWith('controller-start.lock') ? 'controller_busy':'WORKFLOW_STAGE_BUSY') : 'unsupported');
  const current=new Set([...(owned ?? []),path]);
  try { return await contexts.run(current,action); }
  finally {current.delete(path);await lock.release();}
}
export async function inspectWorkflowLock({path}, ports = {}) {
  try {const lock = await acquire(path,ports); if(lock.state === 'owned'){await lock.release();return 'free';}return lock.state === 'busy' ? 'held':'unknown';}
  catch {return 'unknown';}
}
function claimPath({kind,nativeSessionId,owner},ports) {
  if (!['codex','claude'].includes(kind) || !owner || !validGeneration(owner.backendGen ?? owner.generation)) throw error('unsupported');
  const base = join(ports.home ?? homedir(),'.pdd','claims');
  if (nativeSessionId !== null) {
    if (!UUID.test(nativeSessionId ?? '')) throw error('unsupported');
    return join(base,`${kind}-${nativeSessionId}.lock`);
  }
  if (UUID.test(owner.runId ?? '') && UUID.test(owner.attemptId ?? '') && validGeneration(owner.backendGen))
    return join(base,`stage-${owner.runId}-${owner.attemptId}-${owner.backendGen}.lock`);
  if (UUID.test(owner.launchId ?? '')) return join(base,`launch-${owner.launchId}-${owner.backendGen ?? owner.generation}.lock`);
  throw error('unsupported');
}
export async function claimWorkflowSession(spec, ports = {}) {
  try {
    const path = claimPath(spec,ports);
    // Durable current-generation authority must be read by its owning journal/launch adapter.
    if (typeof ports.validateOwner !== 'function') return {state:'uncertain',code:'unsupported'};
    const owner = await ports.validateOwner(spec);
    if (owner?.state === 'retired') return {state:'retired'};
    if (owner?.state !== 'current' || owner?.successorPending === true || owner?.oldProcessStopped === false) return {state:'uncertain'};
    const lock = await acquire(path,ports);
    if (lock.state !== 'owned') return {state:lock.state === 'busy'?'busy':'uncertain',code:lock.code,
      message:lock.state === 'busy' && spec.nativeSessionId ? `${spec.kind} session ${spec.nativeSessionId} already runs here`:undefined};
    // Recheck authority after acquiring exclusion, before exposing a usable claim.
    let current;try{current=await ports.validateOwner(spec);}catch{current=null;}
    if (current?.state !== 'current' || current?.successorPending || current?.oldProcessStopped === false) {await lock.release();return {state:current?.state === 'retired'?'retired':'uncertain'};}
    const record={kind:spec.kind,nativeSessionId:spec.nativeSessionId,owner:Object.freeze(structuredClone(spec.owner)),locks:[lock],released:false};
    const handle=Object.freeze({state:'owned',path,kind:record.kind,owner:record.owner,
      get nativeSessionId(){return record.nativeSessionId;},
      async release(){if(record.released)return;record.released=true;for(const l of record.locks)await l.release();}});
    claims.set(handle,record);return handle;
  } catch {return {state:'uncertain',code:'unsupported'};}
}
export async function promoteWorkflowClaim({claim,kind,nativeSessionId}, ports = {}) {
  const record=claims.get(claim);
  if (!record || record.released || kind !== record.kind || !UUID.test(nativeSessionId ?? '')) return {state:'uncertain'};
  if (record.nativeSessionId) return record.nativeSessionId === nativeSessionId ? claim : {state:'uncertain'};
  if (record.pendingNative && record.pendingNative !== nativeSessionId) return {state:'uncertain'};
  if (!ports.bindClaim||!ports.validateOwner) return {state:'uncertain',code:'unsupported'};
  let authority;try{authority=await ports.validateOwner({kind,nativeSessionId:null,owner:record.owner});}catch{}
  if(authority?.state!=='current'||authority.successorPending||authority.oldProcessStopped===false)return {state:authority?.state==='retired'?'retired':'uncertain'};
  if (!record.nativeLock) {
    const lock = await acquire(claimPath({kind,nativeSessionId,owner:record.owner},ports),ports);
    if(lock.state !== 'owned') return {state:lock.state === 'busy'?'busy':'uncertain'};
    record.nativeLock=lock;record.pendingNative=nativeSessionId;record.locks.push(lock);
  }
  try {
    const current=await ports.validateOwner({kind,nativeSessionId:null,owner:record.owner});
    if(current?.state!=='current'||current.successorPending||current.oldProcessStopped===false)return {state:current?.state==='retired'?'retired':'uncertain'};
    const binding = await ports.bindClaim({owner:record.owner,kind,nativeSessionId});
    if(binding?.ok !== true) return {state:'uncertain'};
    record.nativeSessionId=nativeSessionId;
    await record.locks[0].release();record.locks.shift();return claim;
  } catch {return {state:'uncertain'};}
}

// The invoking managed wrapper validates durable owner/generation before this
// generic command entry. A claim grants exclusion, never continuation authority.
export async function runWorkflowClaimCommand(argv, ports = {}) {
  const [key,separator,command,...args]=argv;
  const match=/^(codex|claude):([0-9a-f-]+)$/.exec(key??'');
  if(!match||!UUID.test(match[2])||separator!=='--'||!command||args.some(a=>typeof a!=='string'))return {exitCode:2,code:'bad_arguments'};
  const path=join(ports.home??homedir(),'.pdd','claims',`${match[1]}-${match[2]}.lock`);
  try{await (ports.fs??{mkdir,access}).mkdir(dirname(path),{recursive:true,mode:0o700});await (ports.fs??{mkdir,access}).access(helperOf(ports),1);}catch{return {exitCode:1,code:'unsupported'};}
  return new Promise(resolve=>{
    const child=(ports.spawn??spawn)(helperOf(ports),['exec',path,'--',command,...args],{stdio:'inherit'});
    const forward=signal=>{try{child.kill(signal);}catch{}};
    const term=()=>forward('SIGTERM'),interrupt=()=>forward('SIGINT'),hangup=()=>forward('SIGHUP');
    process.on('SIGTERM',term);process.on('SIGINT',interrupt);process.on('SIGHUP',hangup);
    const cleanup=()=>{process.off('SIGTERM',term);process.off('SIGINT',interrupt);process.off('SIGHUP',hangup);};
    child.once('error',()=>{cleanup();resolve({exitCode:1,code:'unsupported'});});
    child.once('exit',(code,signal)=>{cleanup();if(code===75)(ports.stderr??process.stderr).write(`${match[1]} session ${match[2]} already runs here\n`);resolve({exitCode:code??(signal==='SIGINT'?130:signal==='SIGHUP'?129:143),signal,code:code===75?'busy':null});});
  });
}
