// Generated from prompts/cli/workflow-projects.prompt.md (sha256: a170dcc46926ca5722f4b57479be5db41046a962e32f944e78c5629150993516).
import {isAbsolute, normalize,join,basename} from 'node:path';
import {realpath,stat,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const SOURCES = ['codexHistory','claudeHistory','herdr','runs','usualPlaces','github'];
const text = x => typeof x === 'string' && x.trim().length > 0 && !/[\x00-\x1f\x7f]/u.test(x);
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
function entry(raw,machineId,source) {
  if (!raw || !text(raw.id) || !text(raw.name) || raw.machineId !== machineId
    || !['local','not_cloned'].includes(raw.availability)
    || !(raw.lastUsedAt === null || Number.isFinite(raw.lastUsedAt) && raw.lastUsedAt >= 0)
    || !(raw.repository === null || raw.repository && text(raw.repository.url)
      && (raw.repository.ref === undefined || text(raw.repository.ref)))
    || (raw.availability === 'local' ? !text(raw.root) || !isAbsolute(raw.root) || normalize(raw.root) !== raw.root
      : raw.root !== null || raw.repository === null)) return null;
  return {id:raw.id,name:raw.name,machineId,repository:raw.repository === null ? null : {...raw.repository},
    root:raw.root,availability:raw.availability,sources:[source],lastUsedAt:raw.lastUsedAt};
}
export async function listWorkflowProjects({machineId} = {}, ports = {}) {
  const warnings = [], rows = [];
  if (!text(machineId)) return {projects:[],warnings:[{source:'catalog',code:'bad_args'}]};
  for (const source of SOURCES) {
    try {
      const adapter = ports.sources?.[source];
      const values = await (typeof adapter === 'function' ? adapter({machineId}) : adapter.read({machineId}));
      if (!Array.isArray(values)) throw Error();
      let invalid = false;
      for (const raw of values) { const value = entry(raw,machineId,source); if (value) rows.push(value); else invalid = true; }
      if (invalid) warnings.push({source,code:'invalid_entries'});
    } catch { warnings.push({source,code:'unavailable'}); }
  }
  const groups = new Map();
  for (const row of rows) {
    const key = row.root ?? `remote:${row.repository.url}:${row.repository.ref ?? ''}`;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  const projects = [];
  for (const group of groups.values()) {
    if (new Set(group.map(r=>r.id)).size !== 1) { warnings.push({source:'catalog',code:'identity_conflict'}); continue; }
    group.sort((a,b)=>cmp(a.name,b.name) || cmp(JSON.stringify(a.repository),JSON.stringify(b.repository)));
    const row = {...group[0],sources:[...new Set(group.flatMap(r=>r.sources))].sort(),
      lastUsedAt:group.some(r=>r.lastUsedAt!==null)?Math.max(...group.filter(r=>r.lastUsedAt!==null).map(r=>r.lastUsedAt)):null};
    projects.push(row);
  }
  const localUrls = new Set(projects.filter(p=>p.root && p.repository).map(p=>p.repository.url));
  for (const local of projects.filter(p=>p.root && p.repository)) {
    const matching=projects.filter(p=>!p.root && p.repository.url===local.repository.url);
    local.sources=[...new Set([...local.sources,...matching.flatMap(p=>p.sources)])].sort();
  }
  const filtered = projects.filter(p=>p.root || !localUrls.has(p.repository.url));
  filtered.sort((a,b)=>(b.lastUsedAt??-1)-(a.lastUsedAt??-1) || cmp(a.name.toLowerCase(),b.name.toLowerCase()) || cmp(a.id,b.id));
  return {projects:filtered,warnings};
}
export async function resolveWorkflowProject({machineId,query} = {},ports = {}) {
  const fail = (state,extra={}) => ({state,code:state,...extra});
  if (!text(query) || /[\\/]|^~|\.\./u.test(query)) return fail('bad_args',{message:'Choose a project by name'});
  const {projects,warnings} = await listWorkflowProjects({machineId},ports);
  const q = query.trim().toLowerCase(), exact = projects.filter(p=>p.name.toLowerCase()===q);
  const candidates = exact.length ? exact : projects.filter(p=>p.name.toLowerCase().includes(q));
  if (!candidates.length) return fail('not_found',{warnings});
  if (candidates.length > 1) return fail('ambiguous',{candidates,warnings});
  const project = candidates[0];
  if (project.availability !== 'local') return fail('needs_clone',{project,warnings});
  try { if (await ports.checkLocal({id:project.id,root:project.root,machineId}) !== true) throw Error(); }
  catch { return fail('unavailable',{warnings}); }
  return {state:'selected',code:null,project,warnings};
}

export function createLocalWorkflowProjectPorts({machineId,cwd,home,scanRoots=[],settings,sources={},readRunIndex}={}) {
  const allowed=new Set();
  const target=input=>{if(input.machineId!==machineId)throw Error('unavailable');};
  async function local(root,lastUsedAt=null) {
    const canonical=await realpath(root);if(!(await stat(canonical)).isDirectory())throw Error();
    let repository=null;
    try {
      const git=args=>execFileSync('git',['-C',canonical,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:2000,maxBuffer:4096}).trim();
      const url=canonicalOrigin(git(['remote','get-url','origin'])),ref=git(['rev-parse','HEAD']);
      if(url && /^[a-f0-9]{40}$/.test(ref))repository={url,ref};
    }catch{}
    allowed.add(canonical);
    return {id:`local:${canonical}`,name:basename(canonical),machineId,repository,root:canonical,availability:'local',lastUsedAt};
  }
  const defaults={
    usualPlaces:{read:async input=>{
      target(input);const rows=[];try{rows.push(await local(cwd));}catch{}
      const configured=settings?.readProjectRoots?await settings.readProjectRoots({machineId}):[];
      if(!Array.isArray(scanRoots)||!Array.isArray(configured)||[...scanRoots,...configured].some(r=>typeof r!=='string'||!isAbsolute(r)))throw Error();
      for(const root of new Set([...scanRoots,...configured])) {
        const children=await readdir(root,{withFileTypes:true});
        for(const entry of children.filter(e=>e.isDirectory()).sort((a,b)=>cmp(a.name,b.name)).slice(0,1000)) {
          try{rows.push(await local(join(root,entry.name)));}catch{}
        }
      }
      return rows;
    }},
    runs:{read:async input=>{
      target(input);const read=readRunIndex??(await import('./workflow-run-records.mjs')).readRunIndex;
      const result=await read({home});if(!Array.isArray(result?.entries))throw Error();
      const rows=[];for(const entry of result.entries){try{rows.push(await local(entry.root,Number.isFinite(entry.startedAt)&&entry.startedAt>=0?entry.startedAt:null));}catch{}}
      return rows;
    }}
  };
  const wrapped={};
  for(const [name,adapter] of Object.entries({...defaults,...sources}))wrapped[name]={read:async input=>{
    target(input);const rows=await (typeof adapter==='function'?adapter(input):adapter.read(input));
    if(Array.isArray(rows))for(const row of rows)if(row?.availability==='local'&&row.id===`local:${row.root}`)allowed.add(row.root);
    return rows;
  }};
  return {sources:wrapped,checkLocal:async candidate=>{
    try{return candidate.machineId===machineId && candidate.id===`local:${candidate.root}` && allowed.has(candidate.root)
      && await realpath(candidate.root)===candidate.root && (await stat(candidate.root)).isDirectory();}catch{return false;}
  }};
}
function canonicalOrigin(value) {
  try {
    const scp=/^git@([^/:?#\s]+):([^?#\s]+)$/.exec(value);
    const url=new URL(scp?`ssh://git@${scp[1]}/${scp[2]}`:value);
    if(url.password||url.search||url.hash||url.port||!['https:','ssh:'].includes(url.protocol)
      || (url.protocol==='ssh:'?url.username!=='git':!!url.username))return null;
    const path=url.pathname.replace(/\.git$/,'');
    if(!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)||path.split('/').some(p=>['.','..'].includes(p)))return null;
    return `https://${url.hostname}${path}`;
  }catch{return null;}
}
