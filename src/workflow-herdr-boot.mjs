// Generated from prompts/cli/workflow-herdr-boot.prompt.md (sha256: 05fdac590c08a5e530c47e274cc5f28cfe9648312c8ef27b90d6d8b9fc92b2c2).
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {join,isAbsolute,relative,sep} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as wait} from 'node:timers/promises';
import {traceHerdrRequest} from './herdr-trace.mjs';

const execute=promisify(execFile),INSTALLER='https://herdr.dev/install.sh';
const supported=p=>['linux','darwin'].includes(p.platform);
const options=p=>({...p,env:p.env??process.env,home:p.home??homedir(),platform:p.platform??process.platform,
  execFile:p.execFile??execute,spawn:p.spawn??spawn});
const result=(state,code=null,message=null,executable=null,installed=false)=>({state,code,message,executable,installed});
const unavailable=(code,reason,executable=null,installed=false)=>result('unavailable',code,reason,executable,installed);
const pathEntries=p=>(p.env.PATH??'').split(':').filter(isAbsolute);
const localBin=p=>join(p.home,'.local','bin');
async function executable(path){
  if(typeof path!=='string'||!isAbsolute(path))return null;
  try{const physical=await fs.realpath(path);if(!(await fs.stat(physical)).isFile())return null;await fs.access(physical,constants.X_OK);return physical;}catch{return null;}
}
async function onPath(p){for(const dir of pathEntries(p)){const found=await executable(join(dir,'herdr'));if(found)return found;}return null;}
const status=r=>r?.code??r?.exitCode??0;
async function command(p,file,argv,timeout,operation,env=p.env,maxBuffer=1024*1024){
  try{
    const run=()=>p.execFile(file,argv,{cwd:p.home,env,shell:false,encoding:'utf8',timeout:Math.max(1,Math.ceil(timeout)),maxBuffer});
    const r=operation?await traceHerdrRequest({operation,request:{session:'default',argv}},run,p):await run();
    return {ok:status(r)===0&&typeof r?.stdout==='string',stdout:r?.stdout??'',exit:status(r),error:null};
  }catch(error){return {ok:false,stdout:'',exit:Number.isInteger(error?.code)?error.code:null,error:error?.code};}
}
function reason(r){
  if(r?.error==='ENOENT')return 'a required executable is missing';
  if(['EACCES','EPERM'].includes(r?.error))return 'permission denied';
  if(['ETIMEDOUT','ABORT_ERR'].includes(r?.error))return 'startup timed out';
  return Number.isInteger(r?.exit)&&r.exit!==0?`startup exited with status ${r.exit}`:'the default session did not answer';
}
async function probe(p,bin,timeout){
  const r=await command(p,bin,['--session','default','workspace','list'],timeout,'workspace.list');
  if(!r.ok)return {...r,ready:false,malformed:false};
  try{const reply=JSON.parse(r.stdout);if(!reply.error&&Array.isArray(reply.result?.workspaces))return {...r,ready:true};}catch{}
  return {...r,ready:false,malformed:true};
}
async function detached(p,bin,timeout){
  try{return await traceHerdrRequest({operation:'server.start',request:{session:'default',argv:[bin,'server']}},()=>new Promise((resolve,reject)=>{
    let child,timer;
    const finish=(error)=>{clearTimeout(timer);child?.removeListener('spawn',started);child?.removeListener('error',failed);if(error)reject(error);else resolve({stdout:'',code:0});};
    const started=()=>{child.unref();finish();};const failed=error=>finish(error);
    try{child=p.spawn(bin,['server'],{cwd:p.home,env:p.env,detached:true,stdio:'ignore',shell:false});child.once('spawn',started);child.once('error',failed);
      timer=setTimeout(()=>{child.removeListener('spawn',started);child.removeListener('error',failed);child.on('error',()=>{});child.unref();reject(Object.assign(Error('startup timed out'),{code:'ETIMEDOUT'}));},Math.max(1,timeout));
    }catch(error){finish(error);}
  }),p);}catch(error){return {stdout:'',code:null,error:error?.code};}
}

export async function ensureDefaultHerdr(ports={}){
  const p=options(ports);let bin;
  try{
    if(!supported(p))return unavailable('unsupported_platform','Herdr default-session startup is supported on Linux and macOS.');
    bin=p.herdrExecutable?await executable(p.herdrExecutable):await onPath(p);
    if(!bin){
      if(!p.herdrExecutable&&await executable(join(localBin(p),'herdr')))return unavailable('herdr_not_on_path','Herdr is installed but is not on PATH. Run export PATH="$HOME/.local/bin:$PATH" in your shell, then rerun pdd setup.');
      return unavailable('herdr_not_installed','Herdr is not installed or available. Run pdd setup to install Herdr.');
    }
    const budget=Number.isInteger(p.herdrStartupTimeoutMs)&&p.herdrStartupTimeoutMs>=1&&p.herdrStartupTimeoutMs<=30000?p.herdrStartupTimeoutMs:5000;
    const deadline=performance.now()+budget,remaining=()=>Math.max(1,Math.ceil(deadline-performance.now()));
    let observed=await probe(p,bin,Math.min(1000,remaining()));
    if(observed.ready)return result('ready',null,null,bin);
    if(observed.malformed)return unavailable('herdr_not_running','Herdr is not running and could not be started: the default session returned an invalid reply.',bin);
    if(performance.now()>=deadline)return unavailable('herdr_not_running','Herdr is not running and could not be started: startup timed out.',bin);
    const started=p.platform==='linux'
      ?await command(p,'systemd-run',['--user','--collect','--unit=herdr-default',bin,'server'],remaining(),'server.start')
      :await detached(p,bin,remaining());
    // A lost startup reply is not permission for a second start. Readiness may
    // still settle after this call or a concurrent caller started the same server.
    const maxProbes=Math.ceil(budget/100)+1;
    for(let i=0;i<maxProbes&&performance.now()<deadline;i++){
      observed=await probe(p,bin,Math.min(1000,remaining()));
      if(observed.ready)return result('ready',null,null,bin);
      if(observed.malformed)break;
      if(performance.now()<deadline&&i+1<maxProbes)await (p.herdrWait??wait)(Math.min(100,remaining()));
    }
    return unavailable('herdr_not_running',`Herdr is not running and could not be started: ${reason(started.ok===false||started.error?started:observed)}.`,bin);
  }catch{return unavailable('herdr_not_running','Herdr is not running and could not be started: local readiness could not be established.',bin??null);}
}

async function ownedDirectory(path){
  const st=await fs.lstat(path);
  return st.isDirectory()&&!st.isSymbolicLink()&&(process.getuid===undefined||st.uid===process.getuid())&&(st.mode&0o022)===0&&await fs.realpath(path)===path;
}
async function safeDestination(home,path){
  const rel=relative(home,path);if(!rel||rel==='..'||rel.startsWith('..'+sep))return false;
  let current=home;for(const part of rel.split(sep)){current=join(current,part);if(!await ownedDirectory(current))return false;}return true;
}
async function occupied(path){try{await fs.lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function installDirectory(p){
  if(!isAbsolute(p.home)||!await ownedDirectory(p.home))throw Error('unsafe home');
  for(const dir of pathEntries(p)){
    const rel=relative(p.home,dir);if(!rel||rel==='..'||rel.startsWith('..'+sep))continue;
    try{if(await safeDestination(p.home,dir)){await fs.access(dir,constants.W_OK);return dir;}}catch{}
  }
  let dir=p.home;for(const name of ['.local','bin']){dir=join(dir,name);try{await fs.mkdir(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}if(!await ownedDirectory(dir))throw Error('unsafe install directory');}
  return dir;
}
async function version(p,bin){const r=await command(p,bin,['--version'],3000,'other');return r.ok&&r.stdout.trim().length>0;}
export async function ensureHerdrInstalled(ports={}){
  const p=options(ports);let temp,bin,installed=false;
  try{
    if(!supported(p))return unavailable('unsupported_platform','Herdr installation is supported on Linux and macOS.');
    bin=await onPath(p);
    if(bin)return await version(p,bin)?result('ready',null,null,bin):unavailable('herdr_unusable','Herdr on PATH did not answer its version check. Repair that installation and rerun pdd setup.',bin);
    bin=await executable(join(localBin(p),'herdr'));
    if(!bin){
      const dir=await installDirectory(p),target=join(dir,'herdr');
      if(await occupied(target))return unavailable('herdr_unusable','The Herdr installation destination is occupied. Preserve it, repair that installation or PATH, and rerun pdd setup.');
      temp=await fs.mkdtemp(join(dir,'.pdd-herdr-install-'));const script=join(temp,'install.sh');
      const download=await command(p,'curl',['--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--max-time','30','--max-filesize','65536',INSTALLER],31000,null,p.env,65536);
      if(!download.ok)return unavailable('herdr_install_failed',`Herdr installation failed: ${reason(download)}. Check HTTPS/curl access to the official Herdr installer and rerun pdd setup.`);
      if(Buffer.byteLength(download.stdout)<1||Buffer.byteLength(download.stdout)>65536)throw Error('invalid installer length');
      await fs.writeFile(script,download.stdout,{flag:'wx',mode:0o600});
      const st=await fs.lstat(script);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<1||st.size>65536)throw Error('invalid installer');await fs.chmod(script,0o600);
      const staging=join(temp,'bin');await fs.mkdir(staging,{mode:0o700});
      const install=await command(p,'/bin/sh',[script],180000,null,{...p.env,HOME:p.home,HERDR_INSTALL_DIR:staging});
      if(!install.ok)return unavailable('herdr_install_failed',`Herdr installation failed: ${reason(install)}. Check the official Herdr installer prerequisites and rerun pdd setup.`);
      const candidate=join(staging,'herdr'),staged=await fs.lstat(candidate);
      if(!staged.isFile()||staged.isSymbolicLink()||staged.nlink!==1||!await executable(candidate)||!await version(p,candidate))throw Error('invalid installed executable');
      try{await fs.link(candidate,target);}catch(e){if(e.code==='EEXIST')return unavailable('herdr_unusable','The Herdr installation destination was claimed concurrently. Preserve it and inspect the existing installation before rerunning pdd setup.');throw e;}
      bin=await executable(target);installed=!!bin;
    }
    if(!bin||!await version(p,bin))return unavailable('herdr_install_failed','Herdr installer did not produce a working executable. Repair the installation and rerun pdd setup.',bin,installed);
    const winner=await onPath(p);
    if(winner!==bin)return unavailable('herdr_not_on_path','Herdr is installed but is not on PATH. Run export PATH="$HOME/.local/bin:$PATH" in your shell, then rerun pdd setup.',bin,installed);
    return result('ready',null,null,bin,installed);
  }catch{return unavailable('herdr_install_failed','Herdr installation could not be completed safely. Check the official installer, user-owned directories and PATH, then rerun pdd setup.',bin??null,installed);}
  finally{if(temp)try{await fs.rm(temp,{recursive:true,force:true});}catch{}}
}
