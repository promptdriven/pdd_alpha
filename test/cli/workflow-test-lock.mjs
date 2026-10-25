// Linux kernel-lock stand-in for module tests; production uses the claims owner.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat} from 'node:fs/promises';
const exec=promisify(execFile);
export async function withWorkflowLock({path},action) {
  const child=spawn('flock',['-n',path,process.execPath,'--input-type=module','-e',"process.stdout.write('locked\\n');process.stdin.resume();"],{stdio:['pipe','pipe','pipe']});
  const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',()=>resolve(127));});
  await new Promise((resolve,reject)=>{
    child.stdout.once('data',()=>resolve());child.once('error',reject);child.once('exit',code=>reject(Object.assign(Error('Another workflow command holds its kernel lock.'),{code:code===1?'WORKFLOW_STAGE_BUSY':'unsupported'})));
  });
  try{return await action();}finally{child.stdin.end();await exited;}
}
export async function inspectWorkflowLock({path}) {
  try{await lstat(path);}catch(e){return e.code==='ENOENT'?'free':'unknown';}
  try{await exec('flock',['-n',path,'true']);return 'free';}catch(e){return e.code===1?'held':'unknown';}
}
