// Generated from prompts/cli/workflow-herdr-client.prompt.md (sha256: 31dfe229eb0c94b1fde4b434b82a267ef7d6b556f8da0110e3c13a2ee73d11ad).
import * as nodeFs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import {homedir} from 'node:os';
import {isAbsolute} from 'node:path';
import {resolveHerdrExecutable} from './workflow-herdr-executable.mjs';
import {traceHerdrRequest} from './herdr-trace.mjs';

const execute=promisify(execFile),positive=n=>Number.isSafeInteger(n)&&n>0;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const W=/^w[0-9A-Za-z]{1,32}$/,P=/^w[0-9A-Za-z]{1,32}:p[0-9A-Za-z]{1,32}$/,T=/^w[0-9A-Za-z]{1,32}:t[0-9A-Za-z]{1,32}$/;
const fault=code=>Object.assign(Error(code),{code});
const config=p=>({...p,fs:p.fs??nodeFs,execFile:p.execFile??execute,env:p.env??process.env,home:p.home??homedir(),platform:p.platform??process.platform});
const exit=r=>r?.code??r?.exitCode??0;
async function osCommand(p,args){
  const r=await p.execFile('ps',args,{cwd:p.home,env:{...p.env,LC_ALL:'C',LANG:'C'},shell:false,encoding:'utf8',timeout:2000,maxBuffer:4096});
  if(exit(r)!==0||typeof r?.stdout!=='string'||Buffer.byteLength(r.stdout)>4096)throw fault('process_unproved');
  return r.stdout.trim();
}
export async function readProcessStartIdentity({pid}={},ports={}){
  if(!positive(pid))return null;
  const p=config(ports);
  try{
    if(p.platform==='linux'){
      const sample=async()=>{
        const boot=(await p.fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();
        const stat=await p.fs.readFile(`/proc/${pid}/stat`,'utf8');
        const end=stat.lastIndexOf(')'),start=stat.indexOf('(');
        if(!UUID.test(boot)||start<1||end<start||stat.slice(0,start).trim()!==String(pid))throw fault('process_unproved');
        const tick=stat.slice(end+1).trim().split(/\s+/)[19];
        if(!/^[1-9]\d{0,29}$/.test(tick??''))throw fault('process_unproved');
        return `linux:${boot}:${tick}`;
      };
      const first=await sample();return first===await sample()?first:null;
    }
    if(p.platform==='darwin'){
      const sample=()=>osCommand(p,['-o','lstart=','-p',String(pid)]);
      const first=await sample();
      if(!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/.test(first)||!Number.isFinite(Date.parse(first)))return null;
      return first===await sample()?`darwin:${first}`:null;
    }
  }catch{}
  return null;
}

export async function createWorkflowHerdrPorts(ports={}){
  const p=config(ports),identity=ports.processStartIdentity!==undefined?ports.processStartIdentity:spec=>readProcessStartIdentity(spec,ports);
  let continuity=null,discovered;
  const executable=async()=>{
    if(Object.hasOwn(p.runtime??{},'herdr')||Object.hasOwn(p,'herdrExecutable'))return resolveHerdrExecutable(p);
    discovered??=await resolveHerdrExecutable(p);return resolveHerdrExecutable({herdrExecutable:discovered});
  };
  const session=r=>{if(r?.session!=='default')throw fault('unsupported');};
  const operand=(v,re)=>{if(typeof v!=='string'||!re.test(v))throw fault('unsupported');return v;};
  const text=v=>{if(typeof v!=='string'||!v||v.includes('\0'))throw fault('unsupported');return v;};
  async function request(operation,args){
    let r;try{r=await traceHerdrRequest({operation,request:{session:'default',argv:args}},async()=>{
      const binary=await executable();
      let response;try{response=await p.execFile(binary,['--session','default',...args],{cwd:p.cwd??p.home,env:p.env,shell:false,encoding:'utf8',timeout:5000,maxBuffer:1024*1024});}catch(error){if(error?.code==='ENOENT')throw Object.assign(Error(`Herdr not found at ${binary}`),{code:'herdr_not_found'});throw error;}
      if(exit(response)!==0)throw Object.assign(fault('herdr_command_uncertain'),{exitCode:exit(response)});
      if(typeof response?.stdout!=='string'||Buffer.byteLength(response.stdout)>1024*1024)throw fault('herdr_invalid_reply');
      if(operation==='pane.run'&&response.stdout==='')return {result:{}};
      let reply;try{reply=JSON.parse(response.stdout);}catch{throw fault('herdr_invalid_reply');}
      if(operation==='server.status'&&reply&&!reply.error&&reply.server&&typeof reply.server==='object')return {result:reply};
      if(!reply||reply.error||!reply.result||typeof reply.result!=='object')throw fault('herdr_invalid_reply');
      return reply;
    },ports);}catch(error){if(error?.code==='herdr_not_found')throw error;throw fault('herdr_command_uncertain');}
    return r.result;
  }
  async function inventory(){
    const r=await request('pane.list',['pane','list']);
    if(!Array.isArray(r.panes)||r.panes.length>10000||r.panes.some(x=>!P.test(x?.pane_id??'')))throw fault('herdr_invalid_reply');
    const ids=r.panes.map(x=>x.pane_id);if(new Set(ids).size!==ids.length)throw fault('herdr_invalid_reply');
    return ids.sort();
  }
  async function rawProcess(paneId){
    const r=await request('pane.process_info',['pane','process-info','--pane',operand(paneId,P)]);
    const info=r.process_info;
    if(info?.pane_id!==paneId||!Array.isArray(info.foreground_processes))throw fault('process_unproved');
    return info;
  }
  function foregroundLeader(info){
    const rows=info.foreground_processes;
    let candidates;
    if(Object.hasOwn(info,'foreground_process_group_id')){
      if(!positive(info.foreground_process_group_id))throw fault('process_unproved');
      candidates=rows.filter(x=>x?.pid===info.foreground_process_group_id);
    }else candidates=rows;
    if(candidates.length!==1)throw fault('process_unproved');
    const candidate=candidates[0];
    if(!positive(candidate?.pid)||!Array.isArray(candidate.argv)||candidate.argv.length===0||!candidate.argv.every(v=>typeof v==='string'&&!v.includes('\0'))||!isAbsolute(candidate.argv[0]))throw fault('process_unproved');
    return candidate;
  }
  async function capability(paneId){
    const info=await rawProcess(paneId);
    const candidates=[...info.foreground_processes.map(x=>x?.pid),info.shell_pid].filter(positive);
    for(const pid of new Set(candidates)){
      const before=await identity({pid,paneId});if(typeof before!=='string'||!before)continue;
      const after=await rawProcess(paneId);
      if((after.shell_pid===pid||after.foreground_processes.some(x=>x?.pid===pid))&&await identity({pid,paneId})===before)return {paneId,pid,startIdentity:before};
    }
    return null;
  }
  const herdr={
    async supportsProcessIdentity(target){
      if(!['linux','darwin'].includes(p.platform)||typeof identity!=='function')return false;
      try{
        if(target!==undefined){session(target);operand(target?.paneId,P);return await capability(target.paneId)!==null;}
        for(const paneId of await inventory())if(await capability(paneId))return true;
      }catch(error){if(error?.code==='herdr_not_found')throw error;}
      return false;
    },
    async listWorkspaces(r){
      session(r);const reply=await request('workspace.list',['workspace','list']);
      if(!Array.isArray(reply.workspaces)||reply.workspaces.some(w=>!W.test(w?.workspace_id??'')))throw fault('herdr_invalid_reply');
      return reply.workspaces.map(w=>({workspaceId:w.workspace_id,cwd:typeof w.cwd==='string'?w.cwd:null}));
    },
    async createWorkspace(r){
      session(r);const reply=await request('workspace.create',['workspace','create','--cwd',text(r.cwd),r.focus===true?'--focus':'--no-focus']);
      const w=reply.workspace;if(!W.test(w?.workspace_id??''))throw fault('herdr_invalid_reply');
      return {workspaceId:w.workspace_id,cwd:w.cwd};
    },
    async createTab(r){
      session(r);const reply=await request('tab.create',['tab','create','--workspace',operand(r.workspaceId,W),'--cwd',text(r.cwd),'--label',text(r.label),r.focus===true?'--focus':'--no-focus']);
      const t=reply.tab,pane=reply.root_pane;if(!T.test(t?.tab_id??'')||!P.test(pane?.pane_id??'')||typeof pane.terminal_id!=='string'||!pane.terminal_id)throw fault('herdr_invalid_reply');
      if(!t.tab_id.startsWith(r.workspaceId+':')||!pane.pane_id.startsWith(r.workspaceId+':')||pane.tab_id!==t.tab_id)throw fault('herdr_invalid_reply');
      return {tabId:t.tab_id,paneId:pane.pane_id,terminalId:pane.terminal_id};
    },
    async paneRun(r){session(r);return request('pane.run',['pane','run',operand(r.paneId,P),text(r.command)]);},
    async inspectProcessExit(r){
      try{
        session(r);operand(r?.paneId,P);
        if(!positive(r.pid)||typeof r.startIdentity!=='string'||!r.startIdentity||typeof identity!=='function'||!['linux','darwin'].includes(p.platform))return {exited:false};
        const exited=(reason,extra={})=>({exited:true,pid:r.pid,startIdentity:r.startIdentity,paneId:r.paneId,reason,...extra});
        const present=ports.processExists===undefined?async({pid})=>{
          try{process.kill(pid,0);return true;}catch(error){return error?.code==='ESRCH'?false:null;}
        }:ports.processExists;
        const sample=async()=>{
          const current=await identity({pid:r.pid,paneId:r.paneId});
          if(typeof current==='string'&&current)return {identity:current};
          return {gone:typeof present==='function'&&await present({pid:r.pid})===false};
        };
        const first=await sample();
        if(first.gone){if((await sample()).gone)return exited('pid_gone');return {exited:false};}
        if(first.identity&&first.identity!==r.startIdentity){
          const second=await sample();return second.identity===first.identity?exited('identity_changed',{observedStartIdentity:first.identity}):{exited:false};
        }
        const ownShell=info=>{
          const rows=info.foreground_processes.filter(x=>x?.pid===info.shell_pid);
          if(!positive(info.shell_pid)||info.foreground_process_group_id!==info.shell_pid||rows.length!==1)return null;
          const shell=rows[0];return Array.isArray(shell.argv)&&shell.argv.length>0&&shell.argv.every(v=>typeof v==='string'&&!v.includes('\0'))&&isAbsolute(shell.argv[0])?shell:null;
        };
        const before=await rawProcess(r.paneId),shell=ownShell(before);if(!shell)return {exited:false};
        const shellIdentity=await identity({pid:shell.pid,paneId:r.paneId});if(typeof shellIdentity!=='string'||!shellIdentity)return {exited:false};
        const after=await rawProcess(r.paneId),confirmed=ownShell(after);
        if(!confirmed||confirmed.pid!==shell.pid||!isDeepStrictEqual(shell.argv,confirmed.argv)||await identity({pid:shell.pid,paneId:r.paneId})!==shellIdentity)return {exited:false};
        return exited('pane_shell',{shell:{pid:shell.pid,startIdentity:shellIdentity,argv:[...shell.argv]}});
      }catch(error){if(error?.code==='herdr_not_found')throw error;return {exited:false};}
    },
    async processInfo(r){
      try{
      session(r);operand(r.paneId,P);
      const info=await rawProcess(r.paneId);
      const candidate=foregroundLeader(info);
      if(typeof identity!=='function')throw fault('process_unproved');
      const startIdentity=await identity({pid:candidate.pid,paneId:r.paneId});
      if(typeof startIdentity!=='string'||!startIdentity)throw fault('process_unproved');
      const executable=candidate.argv[0];
      const physical=await p.fs.realpath(executable);
      if(p.platform==='linux'&&await p.fs.realpath(`/proc/${candidate.pid}/exe`)!==physical)throw fault('process_unproved');
      if(!['linux','darwin'].includes(p.platform))throw fault('process_unproved');
      const after=await rawProcess(r.paneId),confirmed=foregroundLeader(after);
      if(after.foreground_process_group_id!==info.foreground_process_group_id||confirmed.pid!==candidate.pid||!isDeepStrictEqual(candidate.argv,confirmed.argv)||await identity({pid:candidate.pid,paneId:r.paneId})!==startIdentity)throw fault('process_unproved');
      return {pid:candidate.pid,startIdentity,paneId:r.paneId,executable,argv:[...candidate.argv]};
      }catch(error){if(error?.code==='herdr_not_found')throw error;throw fault('process_unproved');}
    }
  };
  async function serverOwner(socket){
    if(p.platform==='linux'){
      const rows=(await p.fs.readFile('/proc/net/unix','utf8')).split('\n').map(line=>/^\S+\s+\S+\s+\S+\s+00010000\s+0001\s+01\s+(\d+)\s+(.+)$/.exec(line));
      const sockets=rows.filter(row=>row&&row[2]===socket);
      if(sockets.length!==1)throw fault('process_unproved');
      const inode=sockets[0][1],owners=[];
      const names=(await p.fs.readdir('/proc')).filter(name=>/^[1-9]\d*$/.test(name)&&positive(Number(name)));
      let next=0;
      await Promise.all(Array.from({length:Math.min(16,names.length)},async()=>{
        while(next<names.length){
          const name=names[next++];
          try{
            for(const fd of await p.fs.readdir(`/proc/${name}/fd`)){
              let target;try{target=await p.fs.readlink(`/proc/${name}/fd/${fd}`);}catch{continue;}
              if(target===`socket:[${inode}]`){owners.push(Number(name));break;}
            }
          }catch{/* Exited or inaccessible processes supply no socket-owner proof. */}
        }
      }));
      if(owners.length!==1)throw fault('process_unproved');
      return {pid:owners[0],socket,inode};
    }
    if(p.platform==='darwin'){
      const result=await p.execFile('/usr/sbin/lsof',['-nP','-a','-U','-Fp','--',socket],{cwd:p.home,env:p.env,shell:false,encoding:'utf8',timeout:2000,maxBuffer:4096});
      if(exit(result)!==0||typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>4096)throw fault('process_unproved');
      const rows=result.stdout.trim().split('\n');
      if(rows.length!==1||!/^p[1-9]\d*$/.test(rows[0])||!positive(Number(rows[0].slice(1))))throw fault('process_unproved');
      return {pid:Number(rows[0].slice(1)),socket};
    }
    throw fault('process_unproved');
  }
  async function serverStatus(){
    const {server}=await request('server.status',['status','--json']);
    if(server?.running===false&&server.status==='not_running'&&[null,'default'].includes(server.session))throw Object.assign(Error('Herdr is not running. Run pdd setup to start the Herdr service, then inspect pdd workflow status before resuming the saved run.'),{code:'herdr_not_found',reason:'server_absent'});
    if(server?.running!==true||server.status!=='running'||![null,'default'].includes(server.session)||typeof server.socket!=='string'||!isAbsolute(server.socket)||server.socket.includes('\0'))throw fault('process_unproved');
    return server.socket;
  }
  async function observeHerdr(){
    try{
      const socket=await serverStatus(),owner=await serverOwner(socket);
      if(typeof identity!=='function')throw fault('process_unproved');
      const startIdentity=await identity({pid:owner.pid});
      if(typeof startIdentity!=='string'||!startIdentity||await serverStatus()!==socket||!isDeepStrictEqual(await serverOwner(socket),owner)||await identity({pid:owner.pid})!==startIdentity)throw fault('process_unproved');
      const now=(p.herdrObservationNow??Date.now)();if(!Number.isFinite(now))throw fault('process_unproved');
      const server={pid:owner.pid,startIdentity},key=JSON.stringify({...owner,startIdentity});
      if(!continuity||key!==continuity.key||now<continuity.last||now-continuity.last>60000)continuity={upSince:now,stableSince:now,key,last:now};
      else continuity={...continuity,last:now};
      return {complete:true,upSince:continuity.upSince,stableSince:continuity.stableSince,server};
    }catch(error){continuity=null;return {complete:false,upSince:null,stableSince:null,...(error?.code==='herdr_not_found'?{code:error.code,message:error.message,...(error.reason==='server_absent'?{reason:error.reason}:{})}:{})};}
  }
  return {herdr:ports.herdr!==undefined?ports.herdr:herdr,processStartIdentity:identity,observeHerdr:ports.observeHerdr!==undefined?ports.observeHerdr:observeHerdr};
}
