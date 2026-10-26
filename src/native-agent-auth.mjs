// Generated from prompts/cli/native-agent-auth.prompt.md (sha256: 368c4b56452f153585123b4087d1cc30793e5690a4dde1b169394bed30dd275a).
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {delimiter,isAbsolute,join,resolve} from 'node:path';

const execute=promisify(execFile);
export async function checkNativeAgentAuth({agent,cwd}={},ports={}) {
  const reply=(state,code,message)=>({state,code,agent,message});
  const unknown=()=>reply('unavailable','agent_auth_status_unavailable',`${agent} sign-in status is unavailable. Check ${agent==='claude'?'claude auth status':'codex login status'} before starting a workflow.`);
  if(!['codex','claude'].includes(agent))return {state:'unavailable',code:'agent_auth_status_unavailable',agent:null,message:'Choose codex or claude to check native sign-in.'};
  const login=agent==='codex'?'codex login':'claude auth login';
  const blocked=()=>reply('blocked','agent_sign_in_required','Agents need a sign-in: run `pdd accounts add codex` (or claude) when ready.');
  const missing=()=>reply('unavailable','native_agent_missing',`${agent} is not installed. Install it and run ${login}.`);
  if(typeof cwd!=='string'||!isAbsolute(cwd)||/[\p{Cc}\p{Cs}]/u.test(cwd))return unknown();
  try {
    const env=ports.env??process.env,io=ports.fs??fs;
    const explicit=Object.hasOwn(ports.nativeExecutables??{},agent);
    if(!explicit&&typeof env.PATH!=='string')return missing();
    const paths=explicit?[ports.nativeExecutables[agent]]:env.PATH.split(delimiter).map(dir=>join(resolve(cwd,dir),agent));
    let binary;
    for(const path of paths){
      if(typeof path!=='string'||!isAbsolute(path)||/[\p{Cc}\p{Cs}]/u.test(path))continue;
      try{if((await io.stat(path)).isFile()){await io.access(path,constants.X_OK);binary=path;break;}}catch{}
    }
    if(!binary)return missing();
    let result;
    try {
      result=await (ports.execFile??execute)(binary,agent==='codex'?['login','status']:['auth','status','--json'],
        {cwd,env,shell:false,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:5000,maxBuffer:65536});
    } catch(error) {
      if(!Number.isInteger(error?.code)||error.killed||error.signal)return unknown();
      result={code:error.code,stdout:error.stdout,stderr:error.stderr};
    }
    if(!result||result.killed||result.signal||typeof result.stdout!=='string'||typeof result.stderr!=='string')return unknown();
    const {stdout,stderr}=result;
    if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>65536)return unknown();
    const code=result.code!==undefined?result.code:result.exitCode!==undefined?result.exitCode:0;
    if(!Number.isInteger(code)||code<0||code>255||(result.code!==undefined&&result.exitCode!==undefined&&result.code!==result.exitCode))return unknown();
    if(agent==='codex') {
      const lines=(stdout+'\n'+stderr).split(/\r?\n/).map(line=>line.trim());
      const positive=lines.some(line=>/^Logged in using (?:ChatGPT|an? API key(?::[^\r\n]*)?)$/i.test(line));
      const negative=lines.some(line=>/^Not logged in\.?$/i.test(line));
      if(positive&&negative)return unknown();
      if(negative)return blocked();
      return code===0&&positive?reply('ready',null,`${agent} is signed in.`):unknown();
    }
    let status;try{status=JSON.parse(stdout);}catch{return unknown();}
    if(!status||Array.isArray(status)||typeof status!=='object')return unknown();
    if(status.loggedIn===false)return blocked();
    return code===0&&status.loggedIn===true?reply('ready',null,`${agent} is signed in.`):unknown();
  } catch {return unknown();}
}
