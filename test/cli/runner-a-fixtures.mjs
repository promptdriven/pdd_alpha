import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
export const runId='6f1c2d3e-0a1b-4c2d-8e3f-1a2b3c4d5e6f';
export const attemptId='0b1e7a52-3c94-4d1f-a2b8-5e6f7a8b9c0d';
export const nativeId='9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export async function folder(t){const dir=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'fleet-runner-a-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
export function fakeLocks(){const held=new Set();return async({path})=>{if(held.has(path))return {state:'busy'};held.add(path);return {state:'owned',async release(){held.delete(path);}};};}
export async function runtimeFixture(t){
  const root=await folder(t),runDir=join(root,'pdd','workflows',runId),versionRoot=join(root,'versions','old');
  await fs.mkdir(join(versionRoot,'bin'),{recursive:true});await fs.mkdir(runDir,{recursive:true});
  const bin=join(versionRoot,'bin','pdd.mjs');await fs.writeFile(bin,'// saved entry\n');
  const runtime={v:1,releaseId:'old',versionRoot,packageRoot:versionRoot,node:process.execPath,bin,pddVersion:'1',alphaDigest:'a'.repeat(64),clientDigest:null,nodeVersion:process.version,credentialHelper:null,future:{retained:true}};
  const files=[{path:'workflow.json',content:'{"version":1,"name":"test"}'},{path:'step.md',content:'Complete the synthetic stage.'}].map(f=>({...f,sha256:hash(f.content)}));
  const definition={name:'test',version:1,root:'/source/recipe',stages:[{id:'report',kind:'agent',protocol:'report',file:'step.md'}],files};
  definition.digest=hash(JSON.stringify({name:definition.name,version:1,stages:definition.stages,files:files.map(({path,sha256})=>({path,sha256}))}));
  const seed={repository:'example/repo',issue:{number:7,url:'https://github.com/example/repo/issues/7',title:'Synthetic',body:'Task'},baseRef:'main',baseSha:'a'.repeat(40),sourceRoot:'/source',root:'/assigned',project:{id:'p1',name:'Calendar'},launchSelection:{agent:'codex',model:'a',effort:'high'}};
  const guidance=await fs.readFile(new URL('../../docs/prompting-guide.md',import.meta.url),'utf8');
  return {root,runDir,runtime,definition,seed,guidance};
}
