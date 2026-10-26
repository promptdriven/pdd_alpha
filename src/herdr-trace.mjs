// Generated from prompts/cli/herdr-trace.prompt.md (sha256: c6485f51df252b6ecce768b34c06917838ba61979c96cf16f5afd648d705c644).
import {constants,closeSync,fstatSync,ftruncateSync,lstatSync,mkdirSync,openSync,readSync,realpathSync,unlinkSync,writeSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const LIMIT=1024*1024,ROW_LIMIT=4096;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPS=new Set(['server.start','workspace.list','workspace.create','tab.create','pane.run','pane.process_info','pane.split','pane.close','pane.list','agent.start','agent.prompt','agent.get','agent.attach','agent.resume','workflow.prepare','workflow.resume','controller.start','other']);
const TYPES=new Set(['ok','workspace_list','workspace_created','tab_created','pane_created','pane_list','pane_process_info','agent_started','agent_prompted','agent_attached','agent_state','agent']);
const STATES=new Set(['prepared','started','refused','failed','uncertain','ready','running','working','idle','done','blocked','unknown','waiting','waiting_agent','waiting_person','recovery_required','completed']);
const CODES=new Set(['unsupported','controller_busy','launch_history_invalid','launch_binding_conflict','run_not_startable','stale_decision','run_not_waiting','decision_refused','human_wait','runtime_mismatch','assignment_invalid','launch_budget','workspace_unknown','workspace_create_failed','tab_create_failed','launch_io','launch_uncertain','proof_unavailable','process_unproved','proof_conflict','proof_not_durable','controller_exited','herdr_command_uncertain','herdr_invalid_reply','stage_process_unproved','stage_identity_changed','unsupported_platform','ENOENT','EACCES','EPERM','ETIMEDOUT','ECONNREFUSED','ECONNRESET','ENOTFOUND','EPIPE','ENOTCONN','EHOSTUNREACH','ECONNABORTED']);
const NESTED=new Set(['result','process_info','foreground_processes','workspace','workspaces','tab','pane','panes','agent','controller','input']);
const NUMBERS=new Set(['pid','shell_pid','foreground_process_group_id','generation','previousGeneration','backendGen','seq','issueNumber','code','exitCode','timeout']);
const BOOLS=new Set(['ok','started','stopped','refused','complete','interactive_ready','launch_pending','focus']);
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const data=(object,key)=>Object.getOwnPropertyDescriptor(object,key)?.value;
const uid=()=>typeof process.getuid==='function'?process.getuid():undefined;
function owned(s){return uid()===undefined||s.uid===uid();}
function directory(path,create,privateMode=false){
  try{if(create)mkdirSync(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const s=lstatSync(path);
  if(!s.isDirectory()||s.isSymbolicLink()||!owned(s)||(s.mode&0o022)!==0||privateMode&&(s.mode&0o077)!==0)throw Error('unsafe trace directory');
}
function location(ports,create){
  const home=ports.home??homedir();if(typeof home!=='string'||!isAbsolute(home)||realpathSync(home)!==home)throw Error('trace home');
  directory(home,false);const base=join(home,'.pdd'),logs=join(base,'logs');
  directory(base,create);directory(logs,create,true);return join(logs,'herdr-trace.jsonl');
}
function regular(s){if(!s.isFile()||s.nlink!==1||!owned(s)||(s.mode&0o077)!==0||s.size>LIMIT)throw Error('unsafe trace file');}
function version(v){const m=typeof v==='string'&&/^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:[-+][\w.-]+)?$/.exec(v);return m?`${m[1]}.${m[2]}.${m[3]}`:undefined;}
function identifier(key,v){
  if(typeof v!=='string')return;
  if(['runId','launchId'].includes(key))return UUID.test(v)?v:undefined;
  const patterns={workspaceId:/^w[1-9]\d{0,8}$/,workspace_id:/^w[1-9]\d{0,8}$/,tabId:/^w[1-9]\d{0,8}:t[1-9]\d{0,8}$/,tab_id:/^w[1-9]\d{0,8}:t[1-9]\d{0,8}$/,paneId:/^w[1-9]\d{0,8}:p[1-9]\d{0,8}$/,pane_id:/^w[1-9]\d{0,8}:p[1-9]\d{0,8}$/,terminalId:/^term_[a-f0-9]{1,64}$/,terminal_id:/^term_[a-f0-9]{1,64}$/};
  return patterns[key]?.test(v)?v:undefined;
}
function payload(value,depth=0){
  if(!value||typeof value!=='object'||depth>8)return {};
  if(Array.isArray(value))return Array.from({length:Math.min(value.length,8)},(_,i)=>payload(data(value,String(i)),depth+1));
  const out={};
  for(const [k,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))){
    if(!Object.hasOwn(descriptor,'value'))continue;const v=descriptor.value;
    const id=identifier(k,v);if(id!==undefined){out[k]=id;continue;}
    if(NUMBERS.has(k)&&Number.isSafeInteger(v)&&v>=0){out[k]=v;continue;}
    if(BOOLS.has(k)&&typeof v==='boolean'){out[k]=v;continue;}
    if(k==='type'&&TYPES.has(v)||k==='state'&&STATES.has(v)||k==='agent_status'&&STATES.has(v)||k==='code'&&CODES.has(v)){out[k]=v;continue;}
    if(k==='session'&&v==='default'){out[k]=v;continue;}
    if(k==='id'&&typeof v==='string'&&[...OPS].some(op=>v==='cli:'+op.replaceAll('.',':'))){out[k]=v;continue;}
    if(k==='startIdentity'&&typeof v==='string'&&/^\d{1,30}$/.test(v)){out[k]=v;continue;}
    if(k==='name'&&['node','codex','claude','bash','sh','zsh','sudo'].includes(v)){out[k]=v;continue;}
    if(k==='argv'&&Array.isArray(v)){
      out.argc=Math.min(v.length,10000);
      const args=Array.from({length:Math.min(v.length,10000)},(_,i)=>data(v,String(i)));
      if(args[2]==='workflow'&&args[3]==='drive'&&typeof args[4]==='string'&&UUID.test(args[4])){
        out.workflowDrive=true;out.runId=args[4];const i=args.indexOf('--launch-id');if(i>=0&&typeof args[i+1]==='string'&&UUID.test(args[i+1]))out.launchId=args[i+1];
      }
      continue;
    }
    if(k==='argc'&&Number.isSafeInteger(v)&&v>=0&&v<=10000||k==='workflowDrive'&&typeof v==='boolean'){out[k]=v;continue;}
    if(['command','cwd','root','runDir','runtime'].includes(k)){out[k+'Present']=v!=null;if(k==='runtime'&&v&&typeof v==='object'){
      out.runtime={};for(const field of ['node','bin','packageRoot','versionRoot'])out.runtime[field+'Present']=typeof data(v,field+'Present')==='boolean'?data(v,field+'Present'):Object.hasOwn(v,field);
      for(const field of ['nodeVersion','pddVersion']){const n=version(data(v,field));if(n!==undefined)out.runtime[field]=n;}
    }continue;}
    if(['commandPresent','cwdPresent','rootPresent','runDirPresent','runtimePresent','nodePresent','binPresent','packageRootPresent','versionRootPresent'].includes(k)&&typeof v==='boolean'){out[k]=v;continue;}
    if(['nodeVersion','pddVersion'].includes(k)){const n=version(v);if(n!==undefined)out[k]=n;continue;}
    if(NESTED.has(k)&&v&&typeof v==='object'){out[k]=payload(v,depth+1);continue;}
    if(k==='stdout'&&typeof v==='string'&&Buffer.byteLength(v)<=LIMIT){try{out.reply=payload(JSON.parse(v),depth+1);}catch{}continue;}
    if(k==='reply'&&v&&typeof v==='object'){out[k]=payload(v,depth+1);continue;}
    if(k==='error'){
      out.error={kind:'command_failed'};
      if(v&&typeof v==='object'){
        const code=data(v,'code');if(CODES.has(code))out.error.code=code;
        const exit=Number.isInteger(code)?code:data(v,'exitCode');
        if(Number.isSafeInteger(exit)&&exit>=0&&exit<=255)out.error.exitCode=exit;
      }
    }
  }
  return out;
}
function record(value){
  if(!value||value.v!==1||!UUID.test(value.traceId??'')||!OPS.has(value.operation)||!['request','reply','error'].includes(value.phase)||!finite(value.at)||!finite(value.monotonicMs))return null;
  const out={v:1,traceId:value.traceId,operation:value.operation,phase:value.phase,at:value.at,monotonicMs:value.monotonicMs};
  if(finite(value.durationMs))out.durationMs=value.durationMs;
  out.payload=payload(value.payload);return out;
}
function parseRows(text){return text.split('\n').slice(0,-1).slice(-200).flatMap(line=>{if(Buffer.byteLength(line)>ROW_LIMIT)return [];try{const r=record(JSON.parse(line));return r?[r]:[];}catch{return [];}});}
function readBounded(fd){
  const bytes=Buffer.alloc(LIMIT+1);let size=0,count;
  while(size<bytes.length&&(count=readSync(fd,bytes,size,bytes.length-size,size))>0)size+=count;
  if(size>LIMIT)throw Error('oversized trace');return bytes.subarray(0,size).toString('utf8');
}
function append(value,ports){
  let lock,fd,path;
  try{
    path=location(ports,true);lock=openSync(path+'.lock',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);regular(fstatSync(lock));
    fd=openSync(path,constants.O_RDWR|constants.O_CREAT|constants.O_APPEND|(constants.O_NOFOLLOW??0),0o600);const stat=fstatSync(fd);regular(stat);
    const row=record(value);if(!row)return;let text=JSON.stringify(row)+'\n';if(Buffer.byteLength(text)>ROW_LIMIT)text=JSON.stringify({...row,payload:{}})+'\n';
    if(stat.size+Buffer.byteLength(text)>LIMIT){
      const kept=parseRows(readBounded(fd)).map(r=>JSON.stringify(r)+'\n').join('');ftruncateSync(fd,0);if(kept)writeSync(fd,kept);
    }
    writeSync(fd,text);
  }catch{/* Diagnostics never replace the operation's result or repeat an effect. */}
  finally{try{if(fd!==undefined)closeSync(fd);}catch{}try{if(lock!==undefined){closeSync(lock);unlinkSync(path+'.lock');}}catch{}}
}
export async function traceHerdrRequest({operation,request},invoke,ports={}){
  let trace;try{const selector=ports.env?.PDD_TRACE??process.env.PDD_TRACE;if(typeof selector==='string'&&selector.split(',').some(token=>token.trim()==='herdr'))trace={v:1,traceId:randomUUID(),operation:OPS.has(operation)?operation:'other'};}catch{}
  if(!trace)return invoke();
  const start=performance.now();append({...trace,phase:'request',at:Date.now(),monotonicMs:start,payload:request},ports);
  try{
    const reply=await invoke();const end=performance.now();append({...trace,phase:'reply',at:Date.now(),monotonicMs:end,durationMs:Math.max(0,end-start),payload:reply},ports);return reply;
  }catch(error){const end=performance.now();append({...trace,phase:'error',at:Date.now(),monotonicMs:end,durationMs:Math.max(0,end-start),payload:{error}},ports);throw error;}
}
export function readHerdrTrace(ports={}){
  let fd;try{const path=location(ports,false);fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK|(constants.O_NOFOLLOW??0));regular(fstatSync(fd));return parseRows(readBounded(fd));}
  catch{return [];}finally{try{if(fd!==undefined)closeSync(fd);}catch{}}
}
