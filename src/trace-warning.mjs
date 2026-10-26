// Generated from prompts/cli/trace-warning.prompt.md (sha256: de990aa74083c36ca54541a93b1c816f6d423a96c6fa6460a7de1ecf69724e76).
import {Writable} from 'node:stream';
const warned=new WeakSet();
const REASONS={
 pdd_permissions:'~/.pdd is group- or world-writable. Fix: run chmod 700 ~/.pdd.',
 logs_permissions:'~/.pdd/logs has unsafe permissions. Fix: run chmod 700 ~/.pdd/logs.',
 unsafe_directory:'unsafe trace directory ownership, permissions or type. Fix: check that HOME, ~/.pdd and ~/.pdd/logs are owned directories without links; use mode 700 for ~/.pdd and ~/.pdd/logs.',
 unsafe_home:'unsafe trace home identity. Fix: use your actual canonical absolute home directory without aliases.',
 unsafe_file:'unsafe trace file ownership, permissions, type or links. Fix: preserve existing data and use an owned regular, unlinked trace file with mode 600.',
 oversized:'trace exceeds its safe size limit. Fix: archive the old trace and use a new private trace file.',
 busy:'trace writer is busy. Fix: let the active writer finish; inspect stale lock ownership before removing a lock.',
 invalid_record:'trace record could not be safely encoded. Fix: report persistent trace failures; no command retry is needed.',
 io:'trace I/O failed. Fix: check private trace directory ownership, write access and free space; report persistent failures.'
};
const CODES={
 EACCES:'trace write permission denied. Fix: check directory ownership and write access; use mode 700 for ~/.pdd and ~/.pdd/logs and mode 600 for trace files.',
 EPERM:'trace write permission denied. Fix: check directory ownership and write access; use mode 700 for ~/.pdd and ~/.pdd/logs and mode 600 for trace files.',
 EROFS:'trace filesystem is read-only. Fix: make the private trace directory writable on its intended filesystem.',
 ENOSPC:'trace filesystem has no free space. Fix: free space for the private trace directory.',
 EDQUOT:'trace filesystem quota exceeded. Fix: free space or increase the quota for the private trace directory.',
 EMFILE:'too many open files for tracing. Fix: close unused file handles or correct the process file limit.',
 ENFILE:'system file table is full. Fix: release unused system file handles.',
 ELOOP:REASONS.unsafe_file
};
function cleanupWarning(stream,state){
 if(!state.pending)return;state.pending=false;
 if(state.timer)clearTimeout(state.timer);
 try{stream?.removeListener('error',state.onSettlement);}catch{}
 try{stream?.removeListener('close',state.onSettlement);}catch{}
}
function checkWarningClosed(ref,state){
 state.timer=undefined;if(!state.pending)return;
 const stream=ref.deref();
 try{
  if(!stream||stream.closed){cleanupWarning(stream,state);return;}
  scheduleWarningCheck(ref,state);
 }catch{cleanupWarning(stream,state);}
}
function scheduleWarningCheck(ref,state){
 if(!state.pending||state.timer)return;
 // emitClose:false can close without an event. A weak, unreferenced check
 // cleans that observer without guessing when asynchronous _destroy finishes.
 state.timer=setTimeout(checkWarningClosed,10,ref,state);state.timer.unref();
}
function warningCallback(ref,state){
 return error=>{
  if(!state.pending)return;
  const stream=ref.deref();
  if(!error||!stream){cleanupWarning(stream,state);return;}
  scheduleWarningCheck(ref,state);
 };
}
function warningState(){
 const state={pending:true};
 state.onSettlement=function(){cleanupWarning(this,state);};
 return state;
}
function writeWarning(stderr,line){
 if(!(stderr instanceof Writable)){stderr.write(line);return;}
 if(stderr.destroyed||stderr.writableEnded||stderr.writable===false)return;
 const state=warningState();
 try{
  stderr.once('error',state.onSettlement);stderr.once('close',state.onSettlement);
  stderr.write(line,warningCallback(new WeakRef(stderr),state));
 }catch{cleanupWarning(stderr,state);}
}
export function warnTraceWriteFailure(error,ports={}){
 try{
  const stderr=ports.stderr??process.stderr;
  if(warned.has(stderr))return;
  warned.add(stderr);
  let message=REASONS.io;
  try{
   const reason=Object.getOwnPropertyDescriptor(error,'traceReason')?.value;
   const code=Object.getOwnPropertyDescriptor(error,'code')?.value;
   if(typeof reason==='string'&&Object.hasOwn(REASONS,reason))message=REASONS[reason];
   else if(typeof code==='string'&&Object.hasOwn(CODES,code))message=CODES[code];
  }catch{}
  writeWarning(stderr,`Warning: PDD_TRACE could not write: ${message}\n`);
 }catch{/* A warning cannot replace the original operation or retry it. */}
}
