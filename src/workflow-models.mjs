// Generated from prompts/cli/workflow-models.prompt.md (sha256: b7787f64e5a35ce5b5f8caf1ca9b2b6b34bcec2db8e7a62f9b82c6d82ecb6f16).
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const text = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f]/u.test(value);
const refused = code => ({state:'refused',code});
const validPair = (pair, models) => pair && models.some(m => m.id === pair.model
  && (m.efforts.includes(pair.effort) || pair.effort === null && m.defaultEffort === null));
function catalogModels(raw,machineId,agent) {
  if (!raw || raw.machineId !== machineId || raw.agent !== agent || !text(raw.cliVersion)
    || !text(raw.revision) || !Array.isArray(raw.models) || !raw.models.length) throw Error();
  const ids = new Set();
  const models = raw.models.map(m => {
    if (!m || !text(m.id) || ids.has(m.id) || !text(m.label) || typeof m.hidden !== 'boolean'
      || !Array.isArray(m.efforts) || m.efforts.some(e => !text(e)) || new Set(m.efforts).size !== m.efforts.length
      || (m.efforts.length ? !(m.efforts.includes(m.defaultEffort) || agent === 'claude' && m.defaultEffort === null) : m.defaultEffort !== null)) throw Error();
    ids.add(m.id);
    return {id:m.id,label:m.label,efforts:[...m.efforts],defaultEffort:m.defaultEffort,hidden:m.hidden};
  }).filter(m => !m.hidden).map(({hidden,...m})=>m);
  return models;
}
export async function listWorkflowModels({machineId,agent} = {}, ports = {}) {
  if (!text(machineId) || !['codex','claude'].includes(agent)) return refused('bad_args');
  try {
    const raw = await ports.nativeCatalog.read({machineId,agent});
    const models = catalogModels(raw,machineId,agent);
    const settings = await ports.toolDefaults.read({machineId,agent});
    const defaults = settings === null ? raw.nativeDefaults : settings;
    if (!models.length || !validPair(defaults,models)) throw Error();
    return {state:'listed',code:null,catalog:{machineId,agent,cliVersion:raw.cliVersion,
      revision:raw.revision,models,defaults:{model:defaults.model,effort:defaults.effort}}};
  } catch { return refused('catalog_unavailable'); }
}
export async function resolveWorkflowModel({machineId,agent,selection} = {}, ports = {}) {
  if (selection !== undefined && (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || Object.keys(selection).some(k=>!['model','effort'].includes(k))
    || Object.hasOwn(selection,'model') && !text(selection.model)
    || Object.hasOwn(selection,'effort') && !text(selection.effort))) return refused('bad_args');
  const result = await listWorkflowModels({machineId,agent},ports);
  if (result.state !== 'listed') return result;
  const {catalog} = result, override = selection && Object.keys(selection).length > 0;
  const model = selection?.model ?? catalog.defaults.model;
  const found = catalog.models.find(m=>m.id===model);
  if (!found) return refused('bad_args');
  const effort = selection && Object.hasOwn(selection,'effort') ? selection.effort
    : found.efforts.includes(catalog.defaults.effort) ? catalog.defaults.effort : found.defaultEffort;
  if (!validPair({model,effort},catalog.models)) return refused('bad_args');
  return {state:'selected',code:null,selection:{machineId,agent,model,effort,
    cliVersion:catalog.cliVersion,catalogRevision:catalog.revision,source:override?'override':'defaults'}};
}

// Launch availability is separate from strict discovery and Settings validation.
export async function resolveWorkflowLaunchModel({machineId,agent,selection,frozenSelection} = {}, ports = {}) {
  if (!text(machineId) || !['codex','claude'].includes(agent)) return refused('bad_args');
  const frozen = frozenSelection;
  const nativeDefault = frozen?.source === 'native-defaults';
  if (frozen !== undefined && (!frozen || typeof frozen !== 'object' || Array.isArray(frozen) || frozen.machineId !== machineId || frozen.agent !== agent
    || (nativeDefault ? frozen.model !== null || frozen.effort !== null || frozen.cliVersion !== null || frozen.catalogRevision !== null
      : !text(frozen.model) || !(frozen.effort === null || text(frozen.effort))
        || !['defaults','override','settings-fallback'].includes(frozen.source)))) return refused('bad_args');
  let observation, catalogError, settings, settingsRead = false;
  const wrapped = {...ports,
    nativeCatalog:{read:async input => {
      try {return observation = await ports.nativeCatalog.read(input);} catch(error) {catalogError = error;throw error;}
    }},
    toolDefaults:{read:async input => {settingsRead = true;return settings = await ports.toolDefaults.read(input);}}
  };
  // Recovery validates capability support, not today's default choice.
  if (frozen) {
    try {
      const raw = await wrapped.nativeCatalog.read({machineId,agent});
      const models = catalogModels(raw,machineId,agent);
      if (!nativeDefault && !validPair(frozen,models)) return refused('bad_args');
      return {state:'selected',code:null,selection:{...frozen}};
    } catch {
      if (catalogError?.code === 'target_mismatch' || observation && (observation.machineId !== machineId || observation.agent !== agent)) return refused('catalog_unavailable');
      return {state:'selected',code:null,selection:{...frozen},
        warning:`Model list unavailable; using ${frozen.model ?? 'native defaults'}`};
    }
  }
  const result = await resolveWorkflowModel({machineId,agent,selection},wrapped);
  // A foreign observation is never permission to launch on this machine.
  if (catalogError?.code === 'target_mismatch' || observation && (observation.machineId !== machineId || observation.agent !== agent)) return refused('catalog_unavailable');
  if (result.state === 'selected') return result;
  if (result.code !== 'catalog_unavailable') return result;
  // Reaching Settings with visible, validated rows means the list was readable;
  // an invalid default is still a strict refusal, not a discovery outage.
  if (settingsRead && observation?.models?.some(m => !m.hidden)) return result;
  if (!settingsRead) {
    try {settings = await ports.toolDefaults?.read({machineId,agent});} catch {settings = null;}
  }
  const pair = settings && text(settings.model) && (settings.effort === null || text(settings.effort)) ? settings : null;
  const accepted = {machineId,agent,model:pair?.model ?? null,effort:pair?.effort ?? null,
    cliVersion:null,catalogRevision:null,source:pair?'settings-fallback':'native-defaults'};
  return {state:'selected',code:null,selection:accepted,
    warning:`Model list unavailable; using ${accepted.model ?? 'native defaults'}`};
}

// Public local composition. All native observations are projected before use;
// neither raw configuration nor protocol errors cross the adapter boundary.
export function createLocalWorkflowModelPorts({machineId,cwd,settings,executable,claudeExecutable='claude',env=process.env,timeoutMs=10000}={}) {
  return {
    toolDefaults:{read:async input=>{
      if(input.machineId!==machineId)throw Object.assign(Error('catalog_unavailable'),{code:'target_mismatch'});
      return settings ? settings.read(input) : null;
    }},
    nativeCatalog:{read:async input=>{
      if(input.machineId!==machineId)throw Object.assign(Error('catalog_unavailable'),{code:'target_mismatch'});
      if(!['codex','claude'].includes(input.agent))throw Error('catalog_unavailable');
      if(input.agent==='claude')return readClaudeCatalog({machineId,cwd,executable:executable??claudeExecutable,env,timeoutMs});
      const codexExecutable=executable??'codex';
      try {
        const startedAt=Date.now();
        const version=execFileSync(codexExecutable,['--version'],{cwd,env,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:timeoutMs,maxBuffer:4096}).trim();
        const cliVersion=/^codex(?:-cli)? (\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/.exec(version)?.[1];
        if(!cliVersion)throw Error();
        const remaining=timeoutMs-(Date.now()-startedAt);if(remaining<=0)throw Error();
        const {rows,config}=await readCodexCatalog({executable:codexExecutable,cwd,env,timeoutMs:remaining});
        const models=rows.map(m=>({id:m.model,label:m.displayName,hidden:m.hidden,
          efforts:m.supportedReasoningEfforts.map(e=>e.reasoningEffort),
          defaultEffort:m.supportedReasoningEfforts.length?m.defaultReasoningEffort:null}));
        const defaults=rows.filter(m=>m.isDefault===true);
        const model=config.model??(defaults.length===1?defaults[0].model:undefined);
        const selected=models.find(m=>m.id===model);
        const nativeDefaults={model,effort:config.model_reasoning_effort??selected?.defaultEffort};
        const observation={machineId,agent:'codex',cliVersion,models,nativeDefaults};
        return {...observation,revision:createHash('sha256').update(JSON.stringify(observation)).digest('hex')};
      } catch {throw Error('catalog_unavailable');}
    }}
  };
}
async function readCodexCatalog({executable,cwd,env,timeoutMs}) {
  const child=spawn(executable,['app-server'],{cwd,env,stdio:['pipe','pipe','ignore']});
  let seq=0,buffer='',bytes=0,failed=false;
  const pending=new Map();
  const fail=()=>{failed=true;for(const waiter of pending.values())waiter.reject(Error('catalog_unavailable'));pending.clear();};
  const timer=setTimeout(()=>{fail();child.kill('SIGKILL');},timeoutMs);
  child.on('error',fail);child.on('close',fail);child.stdin.on('error',fail);
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
    bytes+=Buffer.byteLength(chunk);if(bytes>2*1024*1024){fail();child.kill('SIGKILL');return;}
    buffer+=chunk;let end;
    while((end=buffer.indexOf('\n'))!==-1){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
      try {
        const message=JSON.parse(line);
        // Never answer server requests: capability discovery has no approval or login path.
        if(message.method && Object.hasOwn(message,'id'))throw Error();
        const waiter=pending.get(message.id);if(!waiter)continue;
        pending.delete(message.id);if(message.error)waiter.reject(Error());else waiter.resolve(message.result);
      }catch{fail();child.kill('SIGKILL');}
    }
  });
  const request=(method,params)=>new Promise((resolve,reject)=>{
    if(failed){reject(Error());return;}
    const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  try {
    await request('initialize',{clientInfo:{name:'pdd',version:'1'},capabilities:{experimentalApi:false,explicitGatewayOauth:true}});
    child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const config=(await request('config/read',{cwd,includeLayers:false}))?.config;
    if(!config || typeof config!=='object')throw Error();
    const rows=[],cursors=new Set();let cursor=null;
    for(let page=0;page<16;page++) {
      const result=await request('model/list',{cursor,limit:100,includeHidden:true});
      if(!Array.isArray(result?.data))throw Error();rows.push(...result.data);
      if(result.nextCursor==null)return {rows,config:{model:config.model,model_reasoning_effort:config.model_reasoning_effort}};
      if(!text(result.nextCursor)||cursors.has(result.nextCursor))throw Error();
      cursors.add(result.nextCursor);cursor=result.nextCursor;
    }
    throw Error();
  } finally {clearTimeout(timer);child.stdin.destroy();child.kill('SIGKILL');fail();}
}

async function readClaudeCatalog({machineId,cwd,executable,env,timeoutMs}) {
  const failure=()=>Error('catalog_unavailable');
  let child,timer;
  try {
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw failure();
    const deadline=performance.now()+timeoutMs;
    const version=execFileSync(executable,['--version'],{cwd,env,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:4096}).trim();
    const cliVersion=/^(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?) \(Claude Code\)$/.exec(version)?.[1];
    if(!cliVersion||performance.now()>=deadline)throw failure();
    const args=['--print','--verbose','--input-format','stream-json','--output-format','stream-json',
      '--no-session-persistence','--safe-mode','--permission-mode','dontAsk','--tools','',
      '--strict-mcp-config','--mcp-config','{"mcpServers":{}}'];
    child=spawn(executable,args,{cwd,env,stdio:['pipe','pipe','ignore'],shell:false});
    const requestId=randomUUID();
    const body=await new Promise((resolve,reject)=>{
      let buffer='',bytes=0,done=false;
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(failure()):resolve(value);};
      timer=setTimeout(()=>finish(failure()),Math.max(1,deadline-performance.now()));
      child.on('error',()=>finish(failure()));child.on('close',()=>finish(failure()));child.stdin.on('error',()=>finish(failure()));
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        if(done)return;
        bytes+=Buffer.byteLength(chunk);if(bytes>2*1024*1024){finish(failure());return;}
        buffer+=chunk;let end;
        while((end=buffer.indexOf('\n'))!==-1&&!done){
          const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
          try{
            const message=JSON.parse(line);
            if(message.type==='control_request')throw failure();
            if(message.type!=='control_response')throw failure();
            const r=message.response;
            if(r?.request_id!==requestId||r.subtype!=='success'||performance.now()>=deadline)throw failure();
            finish(null,r.response);
          }catch{finish(failure());}
        }
      });
      child.stdin.write(JSON.stringify({type:'control_request',request_id:requestId,request:{subtype:'initialize',hooks:{}}})+'\n');
    });
    if(performance.now()>=deadline||body?.claude_code_version!==cliVersion||!Array.isArray(body.models)||!body.models.length||body.models.length>256)throw failure();
    const models=body.models.map(m=>{
      if(!m||!text(m.value)||!text(m.displayName)||typeof m.supportsEffort!=='boolean'||m.hidden!==undefined&&typeof m.hidden!=='boolean'
        ||m.isDefault!==undefined&&typeof m.isDefault!=='boolean'||m.resolvedModel!==undefined&&!text(m.resolvedModel))throw failure();
      const efforts=m.supportedEffortLevels??[];
      if(!Array.isArray(efforts)||efforts.some(e=>!text(e))||new Set(efforts).size!==efforts.length||m.supportsEffort!==Boolean(efforts.length))throw failure();
      const defaultEffort=m.defaultEffort??null;
      if(defaultEffort!==null&&!efforts.includes(defaultEffort))throw failure();
      return {id:m.value,label:m.displayName,hidden:m.hidden??false,efforts:[...efforts],defaultEffort};
    });
    const defaults=body.models.filter(m=>!m.hidden&&(m.value==='default'||m.isDefault===true));
    if(defaults.length!==1)throw failure();
    const selected=models.find(m=>m.id===defaults[0].value);
    const observation={machineId,agent:'claude',cliVersion,models,nativeDefaults:{model:selected.id,effort:selected.defaultEffort}};
    catalogModels({...observation,revision:'validating'},machineId,'claude');
    const revisionInput={...observation,resolvedModels:body.models.map(m=>m.resolvedModel??null)};
    return {...observation,revision:createHash('sha256').update(JSON.stringify(revisionInput)).digest('hex')};
  }catch{throw failure();}
  finally{clearTimeout(timer);child?.stdin.destroy();child?.kill('SIGKILL');}
}
