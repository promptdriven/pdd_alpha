// Generated from prompts/cli/workflow-herdr-service.prompt.md (sha256: 0cca916ceac6ba82cde8f05daa049cb14a0d95b980dd6cf77adefbfa4e063ba3).
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute,dirname} from 'node:path';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {resolveHerdrExecutable} from './workflow-herdr-executable.mjs';
import {readInstallRecord} from './install-record.mjs';
import {validUpdateLease} from './update-lock.mjs';
import {traceHerdrRequest} from './herdr-trace.mjs';
import {ensurePrivateDirectory} from './pdd-directory.mjs';
const execute=promisify(execFile),UNIT='pdd-herdr-default.service',LABEL='ai.promptdriven.pdd-herdr-default';
const repair='Run pdd setup to install and enable the Herdr user service.';
const config=p=>({...p,home:p.home??homedir(),platform:p.platform??process.platform,env:p.env??process.env,execFile:p.execFile??execute});
const uid=()=>process.getuid();
const supported=p=>['linux','darwin'].includes(p.platform);
const fail=()=>Object.assign(Error('Herdr user service could not be verified. Inspect its definition and user-manager permissions, then rerun pdd setup.'),{code:'herdr_service_unavailable'});
const pathOK=p=>typeof p==='string'&&isAbsolute(p)&&!/[\p{Cc}\p{Cs}]/u.test(p);
const quote=s=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$',()=> '$$')+'"';
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function herdrServiceFiles({home,herdr,platform=process.platform}){
 if(!pathOK(home)||!pathOK(herdr))throw fail();
 if(platform==='linux')return [{path:join(home,'.config/systemd/user',UNIT),text:`# PDD default Herdr user service\n[Unit]\nDescription=Herdr default session for PDD\n\n[Service]\nType=simple\nExecStart=${quote(herdr)} server\nWorkingDirectory=${home.replaceAll('%','%%')}/.\nEnvironment=${quote('HOME='+home).replaceAll('$$','$')}\nRestart=on-failure\nRestartSec=2\nKillMode=process\n\n[Install]\nWantedBy=default.target\n`}];
 if(platform==='darwin')return [{path:join(home,'Library/LaunchAgents',LABEL+'.plist'),text:`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array><string>${xml(herdr)}</string><string>server</string></array><key>WorkingDirectory</key><string>${xml(home)}</string><key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(home)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>AbandonProcessGroup</key><true/></dict></plist>\n`}];
 return [];
}
async function selected(p){
 if(Object.hasOwn(p.runtime??{},'herdr')||Object.hasOwn(p,'herdrExecutable'))return resolveHerdrExecutable(p);
 const record=await readInstallRecord({home:p.home},p);
 if(record.code||!record.value?.herdr)throw fail();
 return resolveHerdrExecutable({...p,herdrExecutable:record.value.herdr});
}
async function parents(p,file){
 if(!pathOK(p.home)||await fs.realpath(p.home)!==p.home)throw fail();
 let dir=p.home;
 for(const part of ['',...dirname(file).slice(p.home.length+1).split('/')]){
  if(part)dir=join(dir,part);
  const s=await fs.lstat(dir);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid()||(s.mode&0o022)||await fs.realpath(dir)!==dir)throw fail();
 }
}
async function definition(p,file){
 let handle;
 try{
  await parents(p,file.path);
  handle=await fs.open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const s=await handle.stat();
  if(!s.isFile()||s.uid!==uid()||s.nlink!==1||(s.mode&0o7177)||s.size>16384)throw fail();
  const text=await handle.readFile('utf8'),after=await fs.lstat(file.path);
  if(s.dev!==after.dev||s.ino!==after.ino||text!==file.text)throw fail();
  return true;
 }catch(e){if(e.code==='ENOENT')return false;throw e;}finally{await handle?.close();}
}
async function command(p,program,args,deadline=performance.now()+5000){
 const remaining=Math.floor(deadline-performance.now());if(remaining<1)throw fail();
 let r;try{r=await p.execFile(program,args,{cwd:p.home,env:p.env,shell:false,encoding:'utf8',timeout:remaining,maxBuffer:16384});}
 catch(e){if(performance.now()>=deadline)throw fail();return {ok:false,stdout:'',exit:Number.isInteger(e.code)?e.code:null,error:e.code};}
 if(performance.now()>=deadline)throw fail();
 return {ok:(r?.code??r?.exitCode??0)===0&&typeof r?.stdout==='string',stdout:r?.stdout??'',exit:r?.code??r?.exitCode??0};
}
async function required(p,program,args){const r=await command(p,program,args);if(!r.ok)throw fail();return r.stdout.trim();}
const domain=()=>`gui/${uid()}`;
async function enabled(p){
 if(p.platform==='linux'){
  if(await required(p,'systemctl',['--user','is-enabled',UNIT])!=='enabled'||await required(p,'loginctl',['show-user',String(uid()),'--property=Linger','--value'])!=='yes')throw fail();
 }else{
  const disabled=await required(p,'launchctl',['print-disabled',domain()]);
  if(!new RegExp('"'+LABEL.replaceAll('.','\\.')+'"\\s*=>\\s*false').test(disabled))throw fail();
  await required(p,'launchctl',['print',domain()+'/'+LABEL]);
 }
}
export async function provisionHerdrService({home,runtime,lease},ports={}){
 const p=config({...ports,home,runtime});
 try{
  if(!validUpdateLease(lease,home))return {code:'lock_unavailable',message:'Herdr service setup requires the PDD update lock. Rerun pdd setup.'};
  if(!supported(p))return {code:'unsupported_platform',message:'Herdr user services require Linux or macOS.'};
  const herdr=await selected(p),[file]=herdrServiceFiles({...p,herdr});
  await ensurePrivateDirectory(dirname(file.path));await parents(p,file.path);
  if(!await definition(p,file)){
   let h;try{h=await fs.open(file.path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await h.writeFile(file.text);await h.sync();}catch(e){if(e.code!=='EEXIST')throw e;}finally{await h?.close();}
  }
  if(!await definition(p,file))throw fail();
  if(p.platform==='linux'){
   await required(p,'systemctl',['--user','daemon-reload']);
   await required(p,'systemctl',['--user','enable',UNIT]);
   await required(p,'loginctl',['--no-ask-password','enable-linger',String(uid())]);
  }else{
   await required(p,'launchctl',['enable',domain()+'/'+LABEL]);
   if(!(await command(p,'launchctl',['print',domain()+'/'+LABEL])).ok)await required(p,'launchctl',['bootstrap',domain(),file.path]);
  }
  await enabled(p);
  if(!await definition(p,file))throw fail();
  return {code:null};
 }catch(e){return {code:e.code==='herdr_not_found'?e.code:'herdr_service_unavailable',message:e.code==='herdr_not_found'?e.message:fail().message};}
}
export async function startInstalledHerdr(ports,herdr,timeoutMs){
 const p=config(ports),deadline=performance.now()+timeoutMs;
 if(!supported(p))throw fail();
 const [file]=herdrServiceFiles({...p,herdr});
 if(!await definition(p,file))return {installed:false};
 if(performance.now()>=deadline)throw fail();
 const start=(program,args)=>traceHerdrRequest({operation:'server.start',request:{session:'default',argv:args}},()=>command(p,program,args,deadline),p);
 let r;
 if(p.platform==='linux')r=await start('systemctl',['--user','start',UNIT]);
 else{
  const loaded=await command(p,'launchctl',['print',domain()+'/'+LABEL],deadline);
  r=await start('launchctl',loaded.ok?['kickstart',domain()+'/'+LABEL]:['bootstrap',domain(),file.path]);
 }
 return {installed:true,...r};
}
export async function checkHerdrService(ports={}){
 const p=config(ports),row=(state,detail,next=null)=>({id:'herdr-service',state,detail,next});
 if(!supported(p))return row('skip','Herdr user service is unsupported on this platform.');
 try{
  const herdr=await selected(p),[file]=herdrServiceFiles({...p,herdr});
  if(!await definition(p,file))throw fail();await enabled(p);
  if(p.platform==='linux'){if(await required(p,'systemctl',['--user','is-active',UNIT])!=='active')throw fail();}
  else if(!/\bstate\s*=\s*running\b/.test(await required(p,'launchctl',['print',domain()+'/'+LABEL])))throw fail();
  return row('pass','Herdr user service is enabled and running.');
 }catch{return row('fail','Herdr user service is missing, stopped or unverified.',repair);}
}
