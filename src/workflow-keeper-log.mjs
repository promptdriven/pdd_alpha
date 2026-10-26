// Generated from prompts/cli/workflow-keeper-log.prompt.md (sha256: a787a6714a13e03b0bc0c8fb5227622cefd49b3d545a5cd1682f53f40629b38e).
import * as nodeFs from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {ensurePrivateDirectory} from './pdd-directory.mjs';
import {traceHerdrRequest} from './herdr-trace.mjs';
const LIMIT=1024*1024,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const token=x=>x===null||x==='WAIT'||typeof x==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(x);
function row(x){
  if(!x||x.v!==1||x.runId!==null&&!UUID.test(x.runId??'')||!token(x.decision)||!token(x.code)||!Number.isFinite(x.at)||x.at<0||x.journalSeq!==null&&(!Number.isSafeInteger(x.journalSeq)||x.journalSeq<0)||!['absent','held','started','unknown'].includes(x.controller))return null;
  if(x.reason!==undefined&&(x.reason!=='server_absent'||x.code!=='herdr_not_found'))return null;
  if(x.resetAt!==undefined&&(x.code!=='launch_budget'||!Number.isFinite(x.resetAt)||x.resetAt<0||!Number.isFinite(new Date(x.resetAt).getTime())))return null;
  return {...(x.reason?{reason:x.reason}:{}),...(x.resetAt!==undefined?{resetAt:x.resetAt}:{}),v:1,runId:x.runId,decision:x.decision,code:x.code,at:x.at,journalSeq:x.journalSeq,controller:x.controller};
}
function owned(s){return s.uid===(process.geteuid?.()??s.uid);}
function regular(s){return s.isFile()&&s.nlink===1&&owned(s)&&(s.mode&0o077)===0&&s.size<=LIMIT;}
async function openLog(p,write){
  const fs=p.fs??nodeFs,dir=join(p.home??homedir(),'.pdd','logs');
  if(write)await ensurePrivateDirectory(dir,fs);
  if(await fs.realpath(dir)!==dir)throw Error('unsafe_log');
  const directory=await fs.open(dir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{
    const d=await directory.stat(),named=await fs.lstat(dir);
    if(!d.isDirectory()||!owned(d)||(d.mode&0o077)!==0||d.dev!==named.dev||d.ino!==named.ino)throw Error('unsafe_log');
    const prefix=process.platform==='linux'?'/proc/self/fd':process.platform==='darwin'?'/dev/fd':null;
    if(!prefix)throw Error('unsupported');
    const handle=await fs.open(join(prefix,String(directory.fd),'keeper.jsonl'),(write?constants.O_RDWR|constants.O_CREAT|constants.O_APPEND:constants.O_RDONLY)|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
    try{if(!regular(await handle.stat()))throw Error('unsafe_log');return handle;}catch(error){await handle.close();throw error;}
  }finally{await directory.close();}
}
async function bounded(handle){const buffer=Buffer.alloc(LIMIT+1);let n=0;while(n<buffer.length){const {bytesRead}=await handle.read(buffer,n,buffer.length-n,n);if(!bytesRead)break;n+=bytesRead;}if(n>LIMIT)throw Error('oversized');return buffer.subarray(0,n).toString('utf8');}
function rows(text){return text.split('\n').slice(0,-1).flatMap(line=>{if(Buffer.byteLength(line)>1024)return [];try{const r=row(JSON.parse(line));return r?[r]:[];}catch{return [];}});}
export async function appendKeeperDecision(input,ports={}){
  const value=row({v:1,...input});if(!value)return {ok:false};
  try{return await traceHerdrRequest({operation:'other',request:{runId:value.runId}},async()=>{
    const handle=await openLog(ports,true);
    try{
      const text=JSON.stringify(value)+'\n',saved=await bounded(handle);
      if(saved&&!saved.endsWith('\n'))throw Error('incomplete_log');
      for(const line of saved.split('\n').slice(0,-1)){if(Buffer.byteLength(line)>1024||!row(JSON.parse(line)))throw Error('corrupt_log');}
      if(Buffer.byteLength(saved)+Buffer.byteLength(text)>LIMIT){const kept=rows(saved).slice(-512).map(x=>JSON.stringify(x)+'\n').join('');await handle.truncate(0);if(kept)await handle.write(kept);}
      await handle.write(text);return {ok:true};
    }finally{await handle.close();}
  },ports);}catch{try{(ports.stderr??process.stderr).write('Keeper decision log unavailable.\n');}catch{}return {ok:false};}
}
export async function readKeeperDecision({runId},ports={}){
  if(!UUID.test(runId??''))return null;
  let handle;try{handle=await openLog(ports,false);return rows(await bounded(handle)).filter(x=>x.runId===runId).at(-1)??null;}catch{return null;}finally{await handle?.close().catch(()=>{});}
}
