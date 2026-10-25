// Generated from prompts/cli/workflow-models.prompt.md (sha256: bf0f42c58e8c9397bc078712857ef8bbb821ce5687bd2d50e279b994d36ee55c).
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const text = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f]/u.test(value);
const refused = code => ({state:'refused',code});
const validPair = (pair, models) => pair && models.some(m => m.id === pair.model
  && (m.efforts.length ? m.efforts.includes(pair.effort) : pair.effort === null));
export async function listWorkflowModels({machineId,agent} = {}, ports = {}) {
  if (!text(machineId) || !['codex','claude'].includes(agent)) return refused('bad_args');
  try {
    const raw = await ports.nativeCatalog.read({machineId,agent});
    if (!raw || raw.machineId !== machineId || raw.agent !== agent || !text(raw.cliVersion)
      || !text(raw.revision) || !Array.isArray(raw.models) || !raw.models.length) throw Error();
    const ids = new Set();
    const models = raw.models.map(m => {
      if (!m || !text(m.id) || ids.has(m.id) || !text(m.label) || typeof m.hidden !== 'boolean'
        || !Array.isArray(m.efforts) || m.efforts.some(e => !text(e)) || new Set(m.efforts).size !== m.efforts.length
        || (m.efforts.length ? !m.efforts.includes(m.defaultEffort) : m.defaultEffort !== null)) throw Error();
      ids.add(m.id);
      return {id:m.id,label:m.label,efforts:[...m.efforts],defaultEffort:m.defaultEffort,hidden:m.hidden};
    }).filter(m => !m.hidden).map(({hidden,...m})=>m);
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

// Public local composition. All native observations are projected before use;
// neither raw configuration nor protocol errors cross the adapter boundary.
export function createLocalWorkflowModelPorts({machineId,cwd,settings,executable='codex',env=process.env,timeoutMs=10000}={}) {
  return {
    toolDefaults:{read:async input=>{
      if(input.machineId!==machineId)throw Error('catalog_unavailable');
      return settings ? settings.read(input) : null;
    }},
    nativeCatalog:{read:async input=>{
      if(input.machineId!==machineId || input.agent!=='codex')throw Error('catalog_unavailable');
      try {
        const startedAt=Date.now();
        const version=execFileSync(executable,['--version'],{cwd,env,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:timeoutMs,maxBuffer:4096}).trim();
        const cliVersion=/^codex(?:-cli)? (\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/.exec(version)?.[1];
        if(!cliVersion)throw Error();
        const remaining=timeoutMs-(Date.now()-startedAt);if(remaining<=0)throw Error();
        const {rows,config}=await readCodexCatalog({executable,cwd,env,timeoutMs:remaining});
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
