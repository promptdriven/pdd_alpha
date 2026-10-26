// Linux kernel-lock stand-in for module tests; production uses the claims owner.
import {spawn} from 'node:child_process';
import {lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL(`../../launcher/native/${process.platform}-${process.arch}/pdd-flock`,import.meta.url));
export async function withWorkflowLock({path},action) {
  const child=spawn(helper,['hold',path],{stdio:['pipe','pipe','pipe']});
  const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',()=>resolve(127));});
  await new Promise((resolve,reject)=>{
    child.stdout.once('data',()=>resolve());child.once('error',reject);child.once('exit',code=>{const error=Error('Another workflow command holds its kernel lock.');error.code=code===75?'WORKFLOW_STAGE_BUSY':'unsupported';reject(error);});
  });
  try{return await action();}finally{child.stdin.end();await exited;}
}
export async function inspectWorkflowLock({path}) {
  try{await lstat(path);}catch(e){return e.code==='ENOENT'?'free':'unknown';}
  const child=spawn(helper,['hold',path],{stdio:['pipe','pipe','pipe']});
  return await new Promise(resolve=>{
    child.stdout.once('data',()=>{child.stdin.end();resolve('free');});
    child.once('error',()=>resolve('unknown'));
    child.once('exit',code=>{if(code!==0)resolve(code===75?'held':'unknown');});
  });
}
