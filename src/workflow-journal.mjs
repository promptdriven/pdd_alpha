// Generated from prompts/cli/workflow-journal.prompt.md (sha256: 2e347e46af5a0148e311caf56d19979f837d61ed0a83896a4ccd1229b232b85d).
import {isDeepStrictEqual} from 'node:util';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.hasOwn(o,k);
const invalid=()=>{throw Error('Saved workflow journal record is invalid.');};
const clone=x=>JSON.parse(JSON.stringify(x));
const define=(o,k,v)=>Object.defineProperty(o,k,{value:v,writable:true,enumerable:true,configurable:true});
function changes(before,after,path=[],out=[]){
  for(const key of Object.keys(before))if(!own(after,key))out.push({path:[...path,key],remove:true});
  for(const key of Object.keys(after)){
    if(!own(before,key))out.push({path:[...path,key],value:after[key]});
    else if(object(before[key])&&object(after[key]))changes(before[key],after[key],[...path,key],out);
    else if(!isDeepStrictEqual(before[key],after[key]))out.push({path:[...path,key],value:after[key]});
  }
  return out;
}
export function encodeWorkflowJournalRecord(previous,state,metadata={}){
  const next=clone(state),head={...metadata,v:1,seq:next.seq,runId:next.runId};
  if(!Number.isSafeInteger(next.seq)||next.seq<1||typeof next.runId!=='string')invalid();
  const snapshot={...head,state:next};
  if(!previous||next.seq%128===0)return snapshot;
  if(previous.seq!==next.seq-1||previous.runId!==next.runId)invalid();
  const before=clone(previous);before.seq=next.seq;
  const delta={...head,baseSeq:previous.seq,delta:changes(before,next)};
  return Buffer.byteLength(JSON.stringify(delta))<Buffer.byteLength(JSON.stringify(snapshot))?delta:snapshot;
}
export function replayWorkflowJournalRecord(previous,row){
  if(!object(row)||!Number.isSafeInteger(row.seq)||row.seq<1||previous&&row.seq!==previous.seq+1)invalid();
  const snapshot=own(row,'state'),delta=own(row,'delta');
  if(snapshot===delta||own(row,'v')&&row.v!==1)invalid();
  if(snapshot){
    if(!object(row.state)||own(row,'v')&&row.state.seq!==row.seq||own(row,'baseSeq')
      ||own(row,'v')&&row.runId!==row.state.runId||previous&&row.state.runId!==previous.runId)invalid();
    return row.state;
  }
  if(row.v!==1||!previous||row.baseSeq!==previous.seq||row.runId!==previous.runId||!Array.isArray(row.delta))invalid();
  const next=clone(previous),paths=[];
  for(const operation of row.delta){
    if(!object(operation)||!Array.isArray(operation.path)||!operation.path.length
      ||operation.path.some(k=>typeof k!=='string')||['seq','runId'].includes(operation.path[0])
      ||Object.keys(operation).some(k=>!['path','value','remove'].includes(k))
      ||(own(operation,'value')?own(operation,'remove'):operation.remove!==true))invalid();
    const path=operation.path;
    if(paths.some(other=>other.slice(0,Math.min(other.length,path.length)).every((k,i)=>k===path[i])))invalid();
    paths.push(path);
    let target=next;
    for(const key of path.slice(0,-1)){
      if(!own(target,key)||!object(target[key]))invalid();
      target=target[key];
    }
    const key=path.at(-1);
    if(operation.remove){if(!own(target,key))invalid();delete target[key];}
    else define(target,key,clone(operation.value));
  }
  next.seq=row.seq;
  return next;
}
