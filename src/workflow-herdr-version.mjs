// Generated from prompts/cli/workflow-herdr-version.prompt.md (sha256: ea43ad63a513601b173f2bf762315265bdb66ccd6d7efe31e4e13bb290c2a963).
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {realpath} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {performance} from 'node:perf_hooks';
import {readHerdrRuntime,resolveHerdrExecutable} from './workflow-herdr-executable.mjs';
const execute=promisify(execFile),limit=64*1024;
const required=['workspace.list','workspace.create','tab.create','pane.list','pane.process_info','pane.send_text','pane.send_keys','pane.read','agent.get','agent.prompt'];
const version=s=>typeof s==='string'&&s.length>0&&s.length<=80&&/^[0-9A-Za-z.+_-]+$/.test(s)?s:null;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const result=(state,code,client,server,compatible,detail,next,handoff=null,missingFeatures=[])=>({state,code,client,server,compatible,missingFeatures,detail,next,handoff});
const unavailable=()=>result('unavailable','herdr_features_unavailable',null,null,null,
 'Required Herdr features could not be verified.',
 'Inspect the selected Herdr installation with pdd setup, then rerun pdd doctor. Keep existing panes open.');
export async function inspectHerdrVersion({session='default'}={},ports={}){
 try{
  if(typeof session!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(session))return unavailable();
  const timeoutMs=ports.timeoutMs??5000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)return unavailable();
  const deadline=performance.now()+timeoutMs,home=ports.home??homedir();
  let runtime=ports.runtime;
  if(!Object.hasOwn(runtime??{},'herdr')&&!Object.hasOwn(ports,'herdrExecutable'))runtime=await readHerdrRuntime({home,runtime:runtime??{}},ports);
  const executable=await resolveHerdrExecutable({...ports,runtime});
  const physical=await realpath(executable);
  const read=async(args,maxBuffer=limit,allowNonzero=false,textOnly=false)=>{
   const remaining=Math.floor(deadline-performance.now());if(remaining<1)throw Error();
   let reply;
   try{reply=await (ports.execFile??execute)(executable,args,{
    cwd:home,env:ports.env??process.env,shell:false,encoding:'utf8',timeout:remaining,killSignal:'SIGKILL',maxBuffer
   });}catch(e){
    if(!allowNonzero||!Number.isInteger(e.code)||e.killed||e.signal)throw Error();
    reply=e;
   }
   if(performance.now()>=deadline||reply?.signal||reply?.killed||typeof reply?.stdout!=='string'||Buffer.byteLength(reply.stdout)>maxBuffer
     ||!allowNonzero&&(reply.code??reply.exitCode??0)!==0)throw Error();
   if(await realpath(executable)!==physical||performance.now()>=deadline)throw Error();
   if(textOnly)return reply.stdout;
   const envelope=JSON.parse(reply.stdout);if(!envelope||envelope.error)throw Error();
   return envelope.result??envelope;
  };
  const status=await read(['--session',session,'status','--json'],limit,true),c=status?.client,s=status?.server;
  if(!c||!s||c.session!==session||typeof c.binary!=='string'||!isAbsolute(c.binary)||/[\p{Cc}\p{Cs}]/u.test(c.binary)
    ||typeof s.running!=='boolean'||Object.hasOwn(s,'session')&&s.session!==session
    ||Object.hasOwn(s,'endpoint_compatible')&&typeof s.endpoint_compatible!=='boolean')return unavailable();
  if(await realpath(c.binary)!==physical||await realpath(executable)!==physical||performance.now()>=deadline)return unavailable();
  const client=version(c.version),server=s.running?version(s.version):null;
  if(s.running?(s.status!=='running'||s.session!==session||typeof s.compatible!=='boolean'):s.status!=='not_running')return unavailable();
  const schema=await read(['api','schema','--json'],1024*1024),entries=schema?.schemas?.request?.oneOf;
  if(!Array.isArray(entries)||!entries.length||entries.length>10000)return unavailable();
  const methods=new Set();
  for(const entry of entries){
   const name=entry?.properties?.method?.const;
   if(typeof name!=='string'||!/^[a-z][a-z0-9_.]{0,100}$/.test(name)||methods.has(name))return unavailable();
   methods.add(name);
  }
  const missingFeatures=required.filter(method=>!methods.has(method));
  const runHelp=await read(['pane','run','--help'],limit,false,true);
  if(!/Usage:[^\n]*\bpane run\b[^\n]*<PANE_ID>[^\n]*<COMMAND>/.test(runHelp))missingFeatures.push('pane run CLI');
  if(!s.running)return result('absent','herdr_not_running',client,null,null,'Herdr has no running server for the selected session.',
   'Run pdd setup to verify the default Herdr service. Keep existing panes in other sessions open.',null,missingFeatures);
  const identityCurrent=async()=>await realpath(executable)===physical&&performance.now()<deadline;
  if(!missingFeatures.length&&s.compatible&&s.endpoint_compatible!==false){
   const workspaces=await read(['--session',session,'workspace','list']);
   if(!Array.isArray(workspaces?.workspaces)||!await identityCurrent())return unavailable();
   return result('compatible',null,client,server,true,'Required Herdr methods are declared and the selected server answered a workspace read.',null);
  }
  if(!await identityCurrent())return unavailable();
  const detail=missingFeatures.length?`Herdr is missing required methods: ${missingFeatures.join(', ')}.`:'The selected Herdr client reports incompatible server transport.';
  if(!missingFeatures.length&&methods.has('server.live_handoff')&&s.capabilities?.live_handoff===true){
   const args=['--session',session,'server','live-handoff','--import-exe',executable];
   const command=[executable,...args].map(quote).join(' ');
   return result('incompatible','herdr_incompatible',client,server,false,detail,
    `Upgrade this running server without closing its panes: ${command}. Then rerun pdd doctor.`,{executable,args,command});
  }
  return result('incompatible','herdr_incompatible',client,server,false,detail,
   'Keep existing panes open. Obtain the publisher\'s latest Herdr client and recheck live-handoff support before migrating the server; do not stop or restart it.',null,missingFeatures);
 }catch{return unavailable();}
}
