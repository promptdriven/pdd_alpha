// Generated from prompts/cli/doctor.prompt.md (sha256: cd174d64260abaddea57306784eeb1bd940945785079a2d0adac9f2cb3007364).
import {readFileSync,readdirSync,existsSync,statfsSync,accessSync,constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readHerdrTrace} from './herdr-trace.mjs';
import {readGitTrace} from './git-trace.mjs';
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const row = (id,state,detail,next=null) => ({id,state,detail,next});
// Only diagnostic vocabulary is printable from an untrusted support adapter.
const safeText = value => typeof value === 'string' && value.length <= 1000
  && !/[\x00-\x1f\x7f]|https?:|wss?:|\bsk-[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:token|secret|password|private.?key|message|transcript|pairing|invite|approval.?proof|endpoint|bearer|sk-)[\s:=_-]/iu.test(value);
function checksFrom(values) {
  if (!Array.isArray(values)) throw Error();
  return values.map(c => {
    if (!c || !/^[a-z][a-z0-9.-]{0,80}$/u.test(c.id) || !['pass','fail','skip'].includes(c.state)
      || !safeText(c.detail) || !c.detail.trim() || (c.state === 'fail' ? !safeText(c.next) || !c.next.trim() : c.next !== null)) throw Error();
    return row(c.id,c.state,c.detail,c.next);
  });
}
const CHECK_IDS = new Set(['modules','runtime','disk','install','retained-runtimes','native-tools','path','herdr','alpha','client-self-check','client-service','relay','membership','provider-cache','vault','keeper','cleanup','cleanup-item']);
const PHASES = new Set(['locked','staged','checked','activating','flipped','link_restarted','ready','rolling_back','rolled_back','downloading','failed']);
const ACCOUNT_STATES = new Set(['ready','unavailable','full','waiting','needs_signin','auto','fixed','Auto']);
const LOG_EVENTS = new Set(['check.completed','check.failed','runtime.checked','install.observed','account.observed','service.observed']);
const nonnegative = x => typeof x==='number' && Number.isFinite(x) && x>=0;
function reportFrom(value) {
  const output = {};
  if (!value || typeof value !== 'object') return output;
  const projectMap=(field,keys,render)=>{
    const raw=value[field];if(!raw || typeof raw!=='object' || Array.isArray(raw))return;
    const result={};for(const key of keys)if(Object.hasOwn(raw,key)){const rendered=render(raw[key]);if(rendered!==undefined)result[key]=rendered;}
    if(Object.keys(result).length)output[field]=result;
  };
  projectMap('versions',['node','pdd','alpha','client','codex','claude','herdr'],v=>{
    if(typeof v!=='string' || v.length>120)return;
    const match=/^v?(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(?:[-+][0-9A-Za-z.-]+)?$/.exec(v);
    return match?`${match[1]}.${match[2]}.${match[3]}`:undefined;
  });
  if(PHASES.has(value.installPhases))output.installPhases=value.installPhases;
  else projectMap('installPhases',['transaction','staging','current','previous'],v=>PHASES.has(v)?v:undefined);
  projectMap('accountStates',['codex','claude','github'],v=>ACCOUNT_STATES.has(v)?v:undefined);
  projectMap('expiries',['codex','claude','github'],v=>nonnegative(v)?v:undefined);
  for(const key of ['lastGoodAt','diskFreeBytes'])if(nonnegative(value[key]))output[key]=value[key];
  if(Array.isArray(value.logLines))output.logLines=value.logLines.flatMap(record=>{
    if(!record || typeof record!=='object' || !LOG_EVENTS.has(record.event))return [];
    const parts=[record.event];
    if(nonnegative(record.at))parts.push(`at=${record.at}`);
    if(CHECK_IDS.has(record.checkId))parts.push(`check=${record.checkId}`);
    if(['pass','fail','skip'].includes(record.state))parts.push(`state=${record.state}`);
    return [parts.join(' ')];
  }).slice(-200);
  return output;
}
function supportChecks(checks) {
  return checks.map(c=>({id:CHECK_IDS.has(c.id)?c.id:'client-check',state:c.state,
    detail:c.state==='pass'?'Local check passed.':c.state==='skip'?'Local check unavailable or inapplicable.':'Local check failed.',
    next:c.state==='fail'?'Inspect this check locally with pdd doctor.':null}));
}
function importCandidate(packageRoot,files) {
  // Imports run in a separate selected-Node process. Candidate stdout/errors are
  // deliberately discarded; no imported diagnostic text becomes a support fact.
  const script=String.raw`
    import fs from 'node:fs';import fsp from 'node:fs/promises';
    import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';
    import child from 'node:child_process';import {registerHooks,syncBuiltinESMExports} from 'node:module';
    import {pathToFileURL} from 'node:url';
    const root=process.argv[1],files=JSON.parse(process.argv[2]);
    const deny=()=>{throw Error('Unavailable in local self-check');};
    for(const object of [fs,fsp])for(const name of ['writeFile','writeFileSync','appendFile','appendFileSync','mkdir','mkdirSync','rm','rmSync','unlink','unlinkSync','rename','renameSync','copyFile','copyFileSync','cp','cpSync','symlink','symlinkSync','link','linkSync','chmod','chmodSync','chown','chownSync','truncate','truncateSync','createWriteStream'])if(name in object)object[name]=deny;
    for(const object of [fs,fsp])for(const name of ['open','openSync']){const original=object[name];if(original)object[name]=function(path,flags,...rest){if(!(flags===undefined||flags==='r'||Number.isInteger(flags)&&flags>=0&&(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND|fs.constants.O_EXCL))===0))deny();return original.call(this,path,flags,...rest);};}
    for(const object of [fs,fsp])for(const name of ['readFile','readFileSync','open','openSync','createReadStream']){const original=object[name];if(original)object[name]=function(path,...args){if(/(?:\.codex\/auth\.json|\.claude\/\.credentials\.json)/.test(String(path)))deny();return original.call(this,path,...args);};}
    for(const object of [http,https])for(const name of ['request','get','createServer'])object[name]=deny;
    for(const object of [net,tls])for(const name of ['connect','createConnection','createServer'])if(name in object)object[name]=deny;
    for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=deny;
    globalThis.fetch=deny;syncBuiltinESMExports();
    const base=pathToFileURL(root+'/').href;
    registerHooks({resolve(s,c,next){const result=next(s,c);if(result.url.startsWith('file:')&&(!result.url.startsWith(base)||/\/(?:phone|accounts|fleet|keeper)\//.test(result.url.slice(base.length))))deny();return result;}});
    const modules=new Map();for(const file of files)modules.set(file,await import(pathToFileURL(file)));
    const get=name=>modules.get(root+'/src/'+name+'.mjs');
    if(get('argument-parser').parseArgv(['--version']).local!=='version')throw Error();
    if(!get('completion').renderCompletion('bash').endsWith('\n'))throw Error();
    const guidance=get('guidance').loadGuidance({packageRoot:root,cwd:root,workflows:true});
    if(typeof guidance!=='string'||!guidance.includes(fs.readFileSync(root+'/docs/prompting-guide.md','utf8')))throw Error();
    if(typeof get('pdd-cli').runPdd!=='function'||typeof get('pdd-cli').renderHelp!=='function')throw Error();
    if(typeof get('native-session').launchNativeSession!=='function'||typeof get('native-flags').nativeArgs!=='function')throw Error();
    const definitions=get('workflow-definition-loader').listWorkflowDefinitions({cwd:root,packageRoot:root});
    if(!Array.isArray(definitions)||!['feature','bug','small-change'].every(name=>definitions.some(d=>d.name===name)))throw Error();
  `;
  execFileSync(process.execPath,['--check',join(packageRoot,'bin/pdd.mjs')],{stdio:'ignore',timeout:10000});
  execFileSync(process.execPath,['--input-type=module','-e',script,packageRoot,JSON.stringify(files)],{stdio:'ignore',timeout:10000});
}
function localChecks(packageRoot) {
  const checks=[], report={versions:{node:process.version}};
  try {
    const files=readdirSync(join(packageRoot,'src')).filter(name=>name.endsWith('.mjs')).map(name=>resolve(packageRoot,'src',name));
    for(const name of ['doctor','pdd-cli','argument-parser','command-catalog','completion','guidance','native-session','native-flags','workflow-definition-loader','workflow-definitions'])
      accessSync(join(packageRoot,`src/${name}.mjs`),constants.R_OK);
    const metadata=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));
    if (typeof metadata.version !== 'string') throw Error(); report.versions.pdd=metadata.version;
    importCandidate(resolve(packageRoot),files);
    checks.push(row('modules','pass','Candidate public modules imported and local self-checks passed.'));
  } catch { checks.push(row('modules','fail','Candidate public module import or self-check failed.','Reinstall the complete selected PDD release.')); }
  try {
    accessSync(process.execPath,constants.X_OK);
    const descriptor=join(packageRoot,'runtime.json');
    if(existsSync(descriptor)) {
      const runtime=JSON.parse(readFileSync(descriptor,'utf8'));
      if(runtime.v!==1 || runtime.versionRoot!==resolve(packageRoot) || runtime.node!==process.execPath
        || runtime.bin!==join(resolve(packageRoot),'bin/pdd.mjs')) throw Error();
      accessSync(runtime.node,constants.X_OK); accessSync(runtime.bin,constants.R_OK);
      checks.push(row('runtime','pass','Selected owned runtime identity matches.'));
    } else checks.push(row('runtime','skip','Source or unmanaged package; no owned runtime descriptor.'));
  } catch { checks.push(row('runtime','fail','Selected owned runtime is missing or inconsistent.','Reinstall the selected runtime using PDD setup.')); }
  try { const disk=statfsSync(packageRoot); report.diskFreeBytes=disk.bavail*disk.bsize;
    checks.push(row('disk',report.diskFreeBytes>0?'pass':'fail',report.diskFreeBytes>0?'Local disk has free space.':'Local disk is full.',report.diskFreeBytes>0?null:'Free local disk space.'));
  } catch { checks.push(row('disk','fail','Local disk could not be inspected.','Check access to the selected package folder.')); }
  for(const id of ['install','retained-runtimes','native-tools','path','herdr']) checks.push(row(id,'skip','Read-only machine observation port unavailable.'));
  return {checks,report};
}
export async function runDoctorCommand(argv,deps={}) {
  const stdout=deps.stdout??process.stdout, stderr=deps.stderr??process.stderr;
  try {
    if(!Array.isArray(argv) || argv.length>1 || argv.some(a=>!['--json','--report','--check-only','--cleanup'].includes(a))) {
      stderr.write('Usage: pdd doctor [--json | --report | --check-only | --cleanup]\n'); return 2;
    }
    const mode=argv[0]?.slice(2)??'text';
    if(mode==='cleanup' && !(deps.stdinIsTTY??Boolean(process.stdin.isTTY))) {
      stderr.write('Cleanup requires an interactive terminal. Rerun pdd doctor --cleanup interactively.\n');return 1;
    }
    let checks=[],report={};
    try { const local=deps.alphaChecks ? await deps.alphaChecks({mode,packageRoot:deps.packageRoot??PACKAGE_ROOT}) : localChecks(deps.packageRoot??PACKAGE_ROOT);
      checks.push(...checksFrom(local.checks??local));report=reportFrom(local.report);
    } catch { checks.push(row('alpha','fail','Public diagnostics unavailable.','Check the selected local package.')); }
    if(deps.clientInstalled || deps.clientAdapter || existsSync(join(deps.packageRoot??PACKAGE_ROOT,'client'))) {
      try {const client=await deps.clientAdapter.doctorChecks({mode});checks.push(...checksFrom(client.checks));Object.assign(report,reportFrom(client.report));}
      catch { checks.push(row('client-self-check','fail','Installed client diagnostics unavailable.','Reinstall the matching client or supply its diagnostic adapter.')); }
    } else for(const id of ['client-service','relay','membership','provider-cache','vault','keeper']) checks.push(row(id,'skip','Client not installed.'));
    if (mode==='cleanup') {
      if (!deps.cleanup?.inventory) checks.push(row('cleanup','skip','No legacy inventory adapter is available.'));
      else {
        const items=await deps.cleanup.inventory();
        if(!Array.isArray(items)) throw Error();
        for(const item of items) {
          if(!item || !safeText(item.id) || !safeText(item.state) || !safeText(item.effect) || item.owned!==true) {
            checks.push(row('cleanup-item','fail','Uncertain legacy item retained.','Inspect ownership before cleanup.'));continue;
          }
          const choices=['keep',...(item.actions??[]).filter(x=>['unload','remove'].includes(x))];
          stdout.write(`${item.id}: ${item.state}; ${item.effect}. Choices: ${choices.join(', ')} (default keep)\n`);
          let choice; try {choice=await deps.cleanup.choose?.({item,choices,default:'keep'});} catch {choice='keep';}
          if(!choices.includes(choice) || choice==='keep') {stdout.write(`Kept ${item.id}.\n`);continue;}
          let ok=false;
          try {const proof=await deps.cleanup.recheck(item);if(proof?.owned===true && proof.identityUnchanged===true && proof.liveReferences===false) ok=(await deps.cleanup.apply({item,choice}))?.ok===true;}catch{}
          checks.push(ok?row('cleanup-item','pass',`Completed ${choice} for ${item.id}.`):row('cleanup-item','fail','Legacy item retained or effect unconfirmed.','Inspect this exact item before retrying cleanup.'));
        }
      }
    }
    const ok=!checks.some(c=>c.state==='fail');
    if(mode==='report'){report.herdrTrace=readHerdrTrace({home:deps.home});report.gitTrace=await readGitTrace({home:deps.home});}
    if(mode==='json') stdout.write(JSON.stringify({ok,checks})+'\n');
    else if(mode==='report') stdout.write(JSON.stringify({ok,checks:supportChecks(checks),...report})+'\n');
    else for(const c of checks) stdout.write(`${c.state.toUpperCase()} ${c.id}: ${c.detail}\n${c.state==='fail'?`  Next: ${c.next}\n`:''}`);
    return ok?0:1;
  } catch { try {stderr.write('Local diagnostics could not be completed. Inspect the local installation and retry.\n');}catch{} return 1; }
}
