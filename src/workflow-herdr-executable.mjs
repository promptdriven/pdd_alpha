// Generated from prompts/cli/workflow-herdr-executable.prompt.md (sha256: 9a5c61518dc4016807c515c761e568a4a133eaccf2ca7c484ff3fd927ac64a42).
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {homedir} from 'node:os';
import {readInstallRecord,writeInstallRecord} from './install-record.mjs';

const present=(o,k)=>o!=null&&Object.hasOwn(o,k);
const valid=p=>typeof p==='string'&&isAbsolute(p)&&!/[\p{Cc}\p{Cs}]/u.test(p);
const missing=path=>Object.assign(Error(`Herdr not found at ${String(path).replace(/[\p{Cc}\p{Cs}]/gu,'')}`),{code:'herdr_not_found'});
const bindingError=()=>Object.assign(Error('Herdr runtime binding is unavailable. Run pdd setup to record its absolute executable.'),{code:'herdr_binding_invalid'});
async function usable(path){try{return valid(path)&&(await fs.stat(path)).isFile()&&(await fs.access(path,constants.X_OK),true);}catch{return false;}}
export async function resolveHerdrExecutable(ports={}){
  const explicit=present(ports.runtime,'herdr')?{path:ports.runtime.herdr}:present(ports,'herdrExecutable')?{path:ports.herdrExecutable}:null;
  if(explicit){if(!await usable(explicit.path))throw missing(explicit.path);return explicit.path;}
  const path=(ports.env??process.env).PATH;
  for(const dir of (typeof path==='string'?path:'').split(':').filter(isAbsolute)){
    const path=join(dir,'herdr');if(await usable(path))return fs.realpath(path);
  }
  throw Object.assign(Error('Herdr not found. Run pdd setup to record its absolute executable.'),{code:'herdr_not_found'});
}
export async function readHerdrRuntime({home=homedir(),runtime},ports={}){
  if(!runtime||present(runtime,'herdr'))return runtime;
  const record=await readInstallRecord({home},ports);if(record.code)throw bindingError();
  if(!present(record.value,'herdr'))return runtime;
  if(!valid(record.value.herdr))throw bindingError();
  return {...runtime,herdr:record.value.herdr};
}
export async function recordHerdrRuntime({home=homedir(),runtime,herdr,lease},ports={}){
  const executable=await resolveHerdrExecutable({herdrExecutable:herdr});
  const record=await readInstallRecord({home},ports);if(record.code)throw bindingError();
  const result=await writeInstallRecord({home,lease,expectedRev:record.value?.rev??0,next:{herdr:executable}},ports);
  if(result.code)throw Object.assign(bindingError(),{code:result.code});
  return {...runtime,herdr:executable};
}
