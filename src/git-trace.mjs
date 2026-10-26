// Generated from prompts/cli/git-trace.prompt.md (sha256: f1136a1a01696f1142ef3d7a15c684464c66122b4cf9e0251583b86f1de05d77).
import {constants} from 'node:fs';
import {mkdir,lstat,realpath,open} from 'node:fs/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {homedir,constants as osConstants} from 'node:os';
import {performance} from 'node:perf_hooks';

const REDACTED='[redacted]', MAX_FIELD=8192, MAX_RECORD=32768, MAX_TAIL=8*1024*1024;
const SIGNALS=new Set(Object.keys(osConstants.signals));
const ERRORS=new Set([...Object.keys(osConstants.errno),'ERR_CHILD_PROCESS_STDIO_MAXBUFFER','ABORT_ERR']);
const own=stat=>typeof process.getuid!=='function'||stat.uid===process.getuid();
const date=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));
const integer=value=>Number.isSafeInteger(value)?value:null;
function redact(value) {
  if(typeof value!=='string')return REDACTED;
  if(value.length>MAX_FIELD)return '[omitted: oversized diagnostic]';
  if(/-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH)/i.test(value))return REDACTED;
  value=value.replace(/\b(?:https?|ssh|git|wss?):\/\/[^\s'"<>]+/gi,raw=>{
    try{const url=new URL(raw);if(!url.username&&!url.password&&!url.search&&!url.hash)return raw;url.username='';url.password='';url.search='';url.hash='';return url.href;}catch{return REDACTED;}
  });
  if(/\b(?:authorization|proxy-authorization|cookie|http(?:\.[^\s=]+)?\.extraheader|credential(?:\.[^\s=]+)?)\s*[:=]/i.test(value)
    ||/\b(?:password|passwd|secret|token|credential|api[_-]?key|access[_-]?key)\s*[:=]/i.test(value))return REDACTED;
  return value.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,REDACTED)
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi,REDACTED)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,REDACTED);
}
function argvOf(argv) {
  if(!Array.isArray(argv)||argv.length>64||argv.some(x=>typeof x!=='string'))return null;
  let secret=false;
  return argv.map(value=>{
    if(secret){secret=false;return REDACTED;}
    if(/^--?(?:password|passwd|token|secret|credential|authorization|cookie|api-key)$/i.test(value)){secret=true;return REDACTED;}
    return redact(value);
  });
}
const GIT_DIAGNOSTICS=[
  /^fatal: could not read (?:Username|Password) for '[^'\r\n]*': (?:terminal prompts disabled|No such device or address)$/,
  /^fatal: Authentication failed for '[^'\r\n]*'$/,
  /^fatal: unable to access '[^'\r\n]*': (?:The requested URL returned error: \d{3}|Could not resolve host: [A-Za-z0-9.-]+|Permission denied|Connection timed out)$/,
  /^(?:fatal|error): (?:cannot|could not|unable to) (?:create|mkdir|create directory|create leading directories of|lock ref|update ref) '[^'\r\n]*': (?:Permission denied|File exists|No such file or directory|Read-only file system)$/i,
  /^fatal: not a git repository \(or any of the parent directories\): \.git$/,
  /^fatal: (?:invalid reference|not a valid object name|bad object):? [A-Za-z0-9_./-]+$/,
  /^fatal: '[^'\r\n]*' already exists$/,
  /^Preparing worktree \(new branch '[^'\r\n]*'\)$/
];
function stderrOf(value) {
  if(typeof value!=='string')return '';
  if(value.length>MAX_FIELD)return '[omitted: oversized diagnostic]';
  if(/-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH)/i.test(value))return REDACTED;
  return value.split('\n').map(line=>{
    if(!line)return '';
    if(line===REDACTED||line==='[omitted: oversized diagnostic]')return line;
    return GIT_DIAGNOSTICS.some(pattern=>pattern.test(line))?redact(line):REDACTED;
  }).join('\n');
}
function project(row) {
  if(!row||row.v!==1||row.event!=='git'||!['returned','rejected'].includes(row.outcome)||!date(row.startedAt)||!date(row.finishedAt)
    ||!Number.isFinite(row.elapsedMs)||row.elapsedMs<0||typeof row.cwd!=='string'||!Array.isArray(row.argv)||row.argv[0]!=='git'
    ||!(row.exit===null||Number.isSafeInteger(row.exit)))return null;
  const argv=argvOf(row.argv);if(!argv)return null;
  return {v:1,event:'git',startedAt:row.startedAt,finishedAt:row.finishedAt,elapsedMs:row.elapsedMs,
    argv,cwd:redact(row.cwd),outcome:row.outcome,exit:row.exit,
    signal:SIGNALS.has(row.signal)?row.signal:null,
    errorCode:ERRORS.has(row.errorCode)?row.errorCode:null,
    stderr:stderrOf(row.stderr)};
}
async function directory(path,create) {
  if(create)try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink()||!own(stat)||(stat.mode&0o022)!==0||await realpath(path)!==path)throw Error('unsafe trace directory');
}
async function tracePath(ports,create) {
  const home=ports.home??homedir();
  if(typeof home!=='string'||!isAbsolute(home)||resolve(home)!==home)throw Error('unsafe trace home');
  await directory(home,false);
  const pdd=join(home,'.pdd'),logs=join(pdd,'logs');
  await directory(pdd,create);await directory(logs,create);
  return join(logs,'git-trace.jsonl');
}
function ordinary(stat) {
  if(!stat.isFile()||stat.nlink!==1||!own(stat)||(stat.mode&0o077)!==0)throw Error('unsafe trace file');
}
async function append(row,ports) {
  const projected=project(row);if(!projected)return;
  const bytes=Buffer.from(JSON.stringify(projected)+'\n');if(bytes.length>MAX_RECORD)return;
  const path=await tracePath(ports,true);
  const h=await open(path,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NONBLOCK|(constants.O_NOFOLLOW??0),0o600);
  try{const stat=await h.stat();ordinary(stat);const named=await lstat(path);if(named.dev!==stat.dev||named.ino!==stat.ino||named.isSymbolicLink())return;
    await h.write(bytes,0,bytes.length);
  }finally{await h.close();}
}
export async function traceGitCommand({argv,cwd},action,ports={}) {
  if((ports.env??process.env).PDD_TRACE!=='git')return action();
  const savedArgv=[...argv],savedCwd=cwd,startedAt=new Date().toISOString(),start=performance.now();
  let response,outcome='returned';
  try{response=await action();return response;}
  catch(error){response=error;outcome='rejected';throw error;}
  finally{
    try{await append({v:1,event:'git',startedAt,finishedAt:new Date().toISOString(),elapsedMs:performance.now()-start,
      argv:['git',...savedArgv],cwd:savedCwd,outcome,
      exit:Number.isInteger(response?.code)?integer(response.code):outcome==='returned'?0:null,
      signal:response?.signal,errorCode:response?.code,stderr:response?.stderr},ports);
    }catch{/* Diagnostics never change command results or authority. */}
  }
}
export async function readGitTrace(ports={}) {
  let h;
  try{
    const path=await tracePath(ports,false),before=await lstat(path);ordinary(before);
    h=await open(path,constants.O_RDONLY|constants.O_NONBLOCK|(constants.O_NOFOLLOW??0));const stat=await h.stat();ordinary(stat);
    if(stat.dev!==before.dev||stat.ino!==before.ino)return [];
    const length=Math.min(stat.size,MAX_TAIL),start=stat.size-length,bytes=Buffer.alloc(length);
    let offset=0;while(offset<length){const r=await h.read(bytes,offset,length-offset,start+offset);if(!r.bytesRead)break;offset+=r.bytesRead;}
    const lines=bytes.subarray(0,offset).toString('utf8').split('\n');lines.pop();if(start>0)lines.shift();
    return lines.slice(-200).flatMap(line=>{if(Buffer.byteLength(line)>MAX_RECORD)return [];try{const row=project(JSON.parse(line));return row?[row]:[];}catch{return [];}});
  }catch{return [];}finally{await h?.close().catch(()=>{});}
}
