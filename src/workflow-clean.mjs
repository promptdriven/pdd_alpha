// Generated from prompts/cli/workflow-clean.prompt.md (sha256: 4106673d20f38ab192ccea2a457d14f5f27e13bea72d4db3adc4596df70c2594).
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,basename,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {lookupIssueWorktree} from './workflow-worktree.mjs';
import {readWorkflowJournal} from './workflow-runner.mjs';
import {appendRunIndex} from './workflow-run-records.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{40}$/;
const DAY=86400000;
const execute=promisify(execFile);
const reason=message=>{throw Error(message);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function absent(path) { try {await fs.lstat(path);return false;} catch(e) {if(e.code==='ENOENT')return true;throw e;} }
async function directory(path) {if(!isAbsolute(path)||await fs.realpath(path)!==path||!(await fs.lstat(path)).isDirectory())reason('unsafe metadata path');}
async function syncDir(path) {const h=await fs.open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await h.sync();}finally{await h.close();}}
async function ensure(path) {
  if(await absent(path)) {await ensure(dirname(path));try{await fs.mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await syncDir(dirname(path));}
  await directory(path);
}
async function ordinary(path) {const s=await fs.lstat(path);if(!s.isFile()||s.nlink!==1||await fs.realpath(path)!==path)reason('unsafe metadata file');return s;}
async function bytes(path) {
  await directory(dirname(path));const before=await ordinary(path),h=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const opened=await h.stat();if(opened.ino!==before.ino||opened.dev!==before.dev)reason('metadata changed');const b=await h.readFile();const after=await h.stat();if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)reason('metadata changed');return b;}finally{await h.close();}
}
async function durable(path,value) {
  await ensure(dirname(path));if(!await absent(path))await ordinary(path);
  const tmp=join(dirname(path),`.${basename(path)}.${randomUUID()}.tmp`),h=await fs.open(tmp,'wx',0o600);
  try{await h.writeFile(JSON.stringify(value)+'\n');await h.sync();}finally{await h.close();}
  await fs.rename(tmp,path);await syncDir(dirname(path));
}
async function tree(path,prefix='') {
  await directory(path);const files=[];
  for(const name of (await fs.readdir(path)).sort()) {
    const full=join(path,name),rel=prefix?`${prefix}/${name}`:name,s=await fs.lstat(full);
    if(s.isDirectory()&&!s.isSymbolicLink())files.push(...await tree(full,rel));
    else {const b=await bytes(full);files.push({path:rel,sha256:hash(b),data:b});}
  }
  return files;
}
async function archiveRun(a,state,runDir,archive,ports) {
  const source=await tree(runDir);
  // The original common-directory snapshot is outside linked-worktree metadata.
  const input=join(a.commonDir,'pdd','workflow-inputs',a.runId);
  if(!await absent(input))for(const f of await tree(input))source.push({...f,path:`original-inputs/${f.path}`});
  if(!source.some(f=>f.path==='journal.jsonl'))reason('journal unavailable');
  const assignmentBytes=Buffer.from(JSON.stringify(a)+'\n');source.push({path:'assignment.json',sha256:hash(assignmentBytes),data:assignmentBytes});
  await ensure(archive);
  for(const f of source) {
    const target=join(archive,f.path);await ensure(dirname(target));
    if(await absent(target)) {const h=await fs.open(target,'wx',0o600);try{await h.writeFile(f.data);await h.sync();}finally{await h.close();}await syncDir(dirname(target));}
    if(hash(await bytes(target))!==f.sha256)reason('archive readback mismatch');
  }
  const manifest={v:1,runId:a.runId,assignment:a,files:source.map(({path,sha256})=>({path,sha256}))};
  await durable(join(archive,'archive-manifest.json'),manifest);await syncDir(archive);
  // A readback of source after archive catches changes during copying.
  const after=await tree(runDir);
  if(!isDeepStrictEqual(after.map(({path,sha256})=>({path,sha256})),source.filter(f=>!f.path.startsWith('original-inputs/')&&f.path!=='assignment.json').map(({path,sha256})=>({path,sha256}))))reason('journal or artifacts changed during archive');
  const entry={v:1,runId:a.runId,workflow:state.name,repo:a.repository,issue:state.issue,agent:state.agent,root:a.worktreePath,runDir:archive,archived:true,archiveRunDir:archive,startedAt:state.startedAt??null,pdd:state.runtime?{node:state.runtime.node,bin:state.runtime.bin,version:state.runtime.pddVersion}:null};
  const written=await (ports.appendRunIndex??appendRunIndex)(entry,ports);
  if(!written?.ok)reason('archive index write failed');
  // A successful advisory writer alone is insufficient for destructive cleanup.
  const index=join(ports.home??homedir(),'.pdd','runs','index.jsonl');await ordinary(index);
  const h=await fs.open(index,constants.O_RDONLY|constants.O_NOFOLLOW);try{await h.sync();const text=await h.readFile('utf8');const last=text.trimEnd().split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(row=>row?.runId===a.runId).at(-1);if(last?.runDir!==archive||last.archived!==true)reason('archive index readback failed');}finally{await h.close();}
  await syncDir(dirname(index));
  return manifest;
}
export async function cleanWorkflowRuns({cwd,now=Date.now(),dryRun=false}={},ports={}) {
  const output={removed:[],retained:[],warnings:[]};
  if(!Number.isFinite(now)||typeof dryRun!=='boolean') {output.warnings.push('Invalid cleanup arguments.');return output;}
  const command=async(root,file,args)=>{const r=await (ports.execFile??execute)(file,args,{cwd:root,shell:false,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});if(r?.code!==undefined&&r.code!==0)reason('command unavailable');return r.stdout;};
  const git=(root,...args)=>command(root,'git',args);
  let common,entries;
  try {
    common=(await git(cwd,'rev-parse','--path-format=absolute','--git-common-dir')).trim();await directory(common);
    const stat=await (ports.statfs??fs.statfs)(cwd);if(Number(stat.bavail)*Number(stat.bsize)<2e9)output.warnings.push('Disk free is below 2 GB; retained work is never removed to make space.');
    const dir=join(common,'pdd','worktree-assignments','runs');if(await absent(dir))return output;await directory(dir);entries=await fs.readdir(dir);
  } catch {output.warnings.push('Run discovery unavailable; nothing removed.');return output;}
  let locks=ports;
  if(!ports.withWorkflowLock||!ports.inspectWorkflowLock)try{locks={...await import('./workflow-claims.mjs'),...ports};}catch{/* Missing exclusion retains work. */}
  const lock=async(path,fn)=>{if(typeof locks.withWorkflowLock!=='function')reason('cleanup exclusion unavailable');await ensure(dirname(path));return locks.withWorkflowLock({path},fn,ports);};
  for(const name of entries.sort()) {
    if(!name.endsWith('.json')||!UUID.test(name.slice(0,-5))) {output.warnings.push('An invalid assignment entry was retained.');continue;}
    const runId=name.slice(0,-5);let archive=null,physicalRemoved=false;
    const retain=(why,extra={})=>output.retained.push({runId,reason:why,...extra});
    try {
      const found=await (ports.lookupIssueWorktree??lookupIssueWorktree)({cwd,runId},ports);
      if(found?.state!=='ready'||!found.assignment)reason('damaged or missing physical assignment');
      const a=found.assignment,runDir=join(a.gitDir,'pdd','workflows',runId);
      if(a.runId!==runId||a.commonDir!==common)reason('physical ownership changed');
      const ownership=join(common,'pdd','run-lifecycle',`${runId}.json`);
      const read=async()=>{const result=await (ports.readWorkflowJournal??readWorkflowJournal)({runDir},ports);const s=result.state;if(!s||s.runId!==runId||!isDeepStrictEqual(s.assignment,a))reason('damaged journal or ownership');return s;};
      const checks=async()=>{
        const s=await read();
        if(!Array.isArray(s.definitions)||s.index!==s.definitions.length||s.pending||s.waitingPerson||s.quota||s.question||s.unresolvedEffect
          || s.controlState!==undefined&&s.controlState!=='completed')reason('unfinished run or wait');
        const pr=s.completed?.filter(c=>c.kind==='pr'&&c.pr).at(-1)?.pr;if(!pr?.url||!Number.isSafeInteger(pr.number))reason('closed pull request unavailable');
        const remote=JSON.parse(await command(a.worktreePath,'gh',['pr','view',String(pr.number),'--repo',a.repository,'--json','url,number,state,closedAt,mergedAt']));
        if(remote.url!==pr.url||remote.number!==pr.number||!['CLOSED','MERGED'].includes(remote.state))reason('pull request is open or unverified');
        const closed=Date.parse(remote.closedAt??remote.mergedAt);if(!Number.isFinite(closed)||now-closed<=7*DAY)reason('not more than seven days since closure');
        if((await git(a.worktreePath,'status','--porcelain=v1','--untracked-files=all','--ignored')).length)reason('changed, untracked or ignored work');
        const head=(await git(a.worktreePath,'rev-parse','HEAD')).trim();if(!SHA.test(head))reason('HEAD unavailable');
        const ref=`refs/heads/${a.branch}`,remoteHead=await git(a.worktreePath,'ls-remote','--exit-code','--refs','origin',ref);
        if(remoteHead.trim()!==`${head}\t${ref}`)reason(remote.state==='CLOSED'?'closed unmerged unique work; Needs you: choose retention':'unpushed work');
        const again=await (ports.lookupIssueWorktree??lookupIssueWorktree)({cwd,runId},ports);if(again?.state!=='ready'||!isDeepStrictEqual(again.assignment,a))reason('physical ownership changed');
        return {s,head};
      };
      const inspectClaims=async s=>{
        if(typeof locks.inspectWorkflowLock!=='function')reason('claim inspection unavailable');
        const inspect=async path=>{if(!await absent(path)&&await locks.inspectWorkflowLock({path},ports)!=='free')reason('live or unknown session claim');};
        for(const item of s.completed??[]) {
          const b=item.backend;if(!b)continue;
          if(b.phase!=='closed')reason('session or stage still retained');
          await inspect(join(ports.home??homedir(),'.pdd','claims',`stage-${runId}-${b.attemptId}-${b.backendGen??1}.lock`));
          if(b.nativeSession?.kind==='id'){
            if(!UUID.test(b.nativeSession.value??'')||!['codex','claude'].includes(b.agent))reason('native claim identity unproved');
            await inspect(join(ports.home??homedir(),'.pdd','claims',`${b.agent}-${b.nativeSession.value}.lock`));
          }
        }
        const launches=join(runDir,'controller-launch');
        if(!await absent(launches)){
          const reader=ports.readControllerLaunches??(await import('./workflow-controller.mjs')).readControllerLaunches;
          for(const launch of await reader({runDir},ports))if(launch.phase!=='exited'&&await ports.verifyStoppedController?.({launch,state:s})!==true)reason('unresolved controller launch');
        }
      };
      if(dryRun) {const {s}=await checks();await inspectClaims(s);
        if(typeof locks.inspectWorkflowLock!=='function')reason('cleanup exclusion unavailable');
        for(const path of [join(common,'pdd','run-lifecycle',`${runId}.lock`),join(runDir,'controller.lock'),join(common,'pdd','workflow-stage-guards',runId,'stage.lock')])
          if(!await absent(path)&&await locks.inspectWorkflowLock({path},ports)!=='free')reason('live or unknown cleanup guard');
        retain('eligible (dry run)',{eligible:true});continue;}
      await lock(join(common,'pdd','run-lifecycle',`${runId}.lock`),async()=>{
        if(!await absent(ownership)) {const saved=JSON.parse(await bytes(ownership));if(saved.state==='archived')reason('already archived');if(!isDeepStrictEqual(saved.assignment,a))reason('archive ownership differs');}
        let final;
        await lock(join(runDir,'controller.lock'),async()=>{
          await lock(join(common,'pdd','workflow-stage-guards',runId,'stage.lock'),async()=>{
            const {s,head}=await checks();
            await inspectClaims(s);
            archive=join(ports.home??homedir(),'.pdd','runs','archive',runId);
            await archiveRun(a,s,runDir,archive,ports);
            await durable(ownership,{v:1,runId,state:'removing',assignment:a,archiveRunDir:archive});
            const verified=await checks();if(verified.head!==head)reason('HEAD changed before removal');
            final={head};
          });
        });
        // Inner descriptors are closed before Git deletes their metadata; stable lifecycle remains held.
        const checked=await checks();if(checked.head!==final.head)reason('HEAD changed before removal');
        await git(cwd,'worktree','remove',a.worktreePath);
        if(!await absent(a.worktreePath)||!await absent(a.gitDir))reason('physical removal unproved');
        const registrations=await git(cwd,'worktree','list','--porcelain','-z');if(registrations.split('\0').includes(`worktree ${a.worktreePath}`))reason('physical removal unproved');
        physicalRemoved=true;
        await durable(ownership,{v:1,runId,state:'archived',assignment:a,archiveRunDir:archive});
        const registry=join(ports.home??homedir(),'.pdd','runs','registry',`${runId}.json`);
        if(!await absent(registry)){const prior=JSON.parse(await bytes(registry));await durable(registry,{...prior,archived:true,archiveRunDir:archive});}
        // Release only this issue's verified claim, after physical removal and archival ownership.
        const claim=join(common,'pdd','worktree-assignments','issues',`${a.issueNumber}.json`);
        if(!await absent(claim)){const current=JSON.parse(await fs.readFile(claim,'utf8'));if(!isDeepStrictEqual(current,a))reason('issue claim changed');await fs.unlink(claim);await syncDir(dirname(claim));}
        output.removed.push({runId,reason:'archived and remote copy verified',archiveRunDir:archive});
      });
    } catch(error) {if(physicalRemoved){output.removed.push({runId,reason:'archived; metadata finalization requires attention',archiveRunDir:archive});output.warnings.push(`Run ${runId}: archival ownership retained; metadata finalization incomplete.`);}else retain(error.message??'cleanup proof unavailable',archive?{archiveRunDir:archive}:{});}
  }
  return output;
}
