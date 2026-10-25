// Generated from prompts/cli/workflow-placement.prompt.md (sha256: 728cff81ddce9583e4183b6a58db7b5c657768d384b8df96ea749d07756d4560).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nonempty = value => typeof value === 'string' && value.length > 0 && !/[\0-\x1f\x7f]/.test(value);
const refuse = (code, message) => ({state:'refused',target:null,code,message});
const local = () => ({state:'local',target:null,code:null,message:'Start on this machine using the local project.'});
function repositoryOK(repository) {
  if (!repository || typeof repository.url !== 'string' || !/^[a-f0-9]{40}$/.test(repository.ref ?? '')) return false;
  // A pinned remote commit is supplied by the caller; never transmit a local ref/path.
  try {
    let address = repository.url;
    const scp = /^git@([^/:?#\s]+):([^?#\s]+)$/.exec(address);
    if (scp) address = `ssh://git@${scp[1]}/${scp[2]}`;
    const url = new URL(address);
    if (url.password || url.search || url.hash || url.port || !url.hostname
      || !['https:','ssh:'].includes(url.protocol)
      || (url.protocol === 'ssh:' ? url.username !== 'git' : !!url.username)) return false;
    // Validate the original path as well: URL parsing normalizes away dot segments.
    const rawPath = scp ? scp[2] : /^[A-Za-z]+:\/\/[^/]+\/(.*)$/.exec(address)?.[1];
    const parts = rawPath?.split('/');
    return parts?.length === 2 && parts.every(part => /^[A-Za-z0-9_.-]+$/.test(part) && !['.','..'].includes(part))
      && url.pathname === `/${rawPath}`;
  } catch { return false; }
}
function validMachine(m) {
  return m && nonempty(m.id) && nonempty(m.name) && typeof m.ownMachine === 'boolean' && typeof m.online === 'boolean'
    && typeof m.herdrReady === 'boolean' && Array.isArray(m.installedAgents) && m.installedAgents.every(nonempty)
    && ['available','OUT'].includes(m.accountPick) && Number.isFinite(m.freeDiskGB) && m.freeDiskGB >= 0
    && typeof m.hasCleanCanonicalClone === 'boolean' && Number.isSafeInteger(m.workingAgentCount) && m.workingAgentCount >= 0
    && Array.isArray(m.tags) && m.tags.every(nonempty);
}
const eligible = (m, agent) => validMachine(m) && m.ownMachine && m.online && m.herdrReady && m.installedAgents.includes(agent) && m.accountPick === 'available' && m.freeDiskGB > 5;
const score = m => 20 * Number(m.hasCleanCanonicalClone) - 5 * m.workingAgentCount - 50 * Number(m.tags.includes('laptop'));
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export async function selectStartTarget(input = {}, ports = {}) {
  const {kind, on = 'auto', sourceMachineId, agent, repository} = input;
  if (!['session','workflow'].includes(kind) || !nonempty(on)) return refuse('bad_args','Supply a valid start kind and machine name.');
  const port = ports.machinePlacement;
  if (port == null) return on === 'auto' ? local() : refuse('remote_unsupported','Remote placement requires the optional local Client integration.');
  if (typeof port.listOwnMachines !== 'function' || typeof port.start !== 'function' || typeof port.inspect !== 'function') return refuse('placement_unavailable','The machine placement integration is unavailable.');
  if (!['codex','claude'].includes(agent) || !nonempty(sourceMachineId)) return refuse('bad_args','Supply the source machine and native tool.');
  if (!repositoryOK(repository)) return on === 'auto' ? local() : refuse('repository_unavailable','A canonical repository and remotely reachable pinned commit are required.');
  let machines;
  try { ({machines} = await port.listOwnMachines({sourceMachineId,kind,agent,need:kind === 'session' ? 3 : 10,repository:structuredClone(repository)})); }
  catch { return refuse('placement_unavailable','The machine inventory could not be read.'); }
  if (!Array.isArray(machines) || machines.some(m => !validMachine(m)) || new Set(machines.map(m=>m.id)).size !== machines.length) return refuse('placement_unavailable','The machine inventory is incomplete or malformed.');
  let candidates = machines.filter(m => eligible(m,agent));
  if (on !== 'auto') {
    const named = machines.filter(m=>m.name === on && m.ownMachine);
    if (named.length !== 1) return refuse(named.length ? 'ambiguous_machine' : 'unknown_machine','Choose one exact unique machine name.');
    if (!eligible(named[0],agent)) return refuse('target_not_eligible','The selected machine is not eligible for this start.');
    candidates = named;
  } else if (kind === 'workflow') {
    const always = candidates.filter(m=>m.tags.includes('alwaysOn'));
    candidates = always.length ? always : candidates.filter(m=>m.id === sourceMachineId);
  }
  candidates.sort((a,b)=>score(b)-score(a) || compare(a.name,b.name) || compare(a.id,b.id));
  if (!candidates.length) return refuse('no_eligible_machine','No eligible machine is available for this start.');
  const {id,name} = candidates[0];
  return {state:'selected',target:{id,name},code:null,message:`Start on ${name} from ${repository.url} at ${repository.ref}.`};
}
export async function dispatchStart(input = {}, ports = {}) {
  const i = structuredClone(input), targetMachineId = i.target?.id ?? null, startId = i.startId ?? null;
  const answer = (state,code,message,receipt = {}) => ({state,targetMachineId,startId,...receipt,code,message});
  if (!repositoryOK(i.repository)) return answer('refused','repository_unavailable','A canonical repository and remotely reachable pinned commit are required.');
  if (!['session','workflow'].includes(i.kind) || !['codex','claude'].includes(i.agent) || !nonempty(targetMachineId) || !UUID.test(startId ?? '')
    || i.project != null && (!nonempty(i.project.id) || !nonempty(i.project.name))
    || i.kind === 'workflow' && (!nonempty(i.workflow?.name) || !nonempty(String(i.workflow?.issue ?? '')))) return answer('refused','bad_args','The durable start binding is invalid.');
  const port = ports.machinePlacement;
  if (!port) return answer('refused','remote_unsupported','Remote starts require the optional local Client integration.');
  if (typeof port.start !== 'function' || typeof port.inspect !== 'function') return answer('refused','placement_unavailable','The remote start integration is unavailable.');
  // Construct the allowed task payload explicitly: source paths, environment and account choices never cross this seam.
  const payload = {targetMachineId,startId,kind:i.kind,agent:i.agent,repository:{url:i.repository.url,ref:i.repository.ref}};
  if (i.project != null) payload.project = {id:i.project.id,name:i.project.name};
  if (i.selectionOverrides != null) {
    payload.selectionOverrides = {};
    for (const key of ['model','effort']) if (i.selectionOverrides[key] !== undefined) payload.selectionOverrides[key] = i.selectionOverrides[key];
  }
  if (i.kind === 'session' && i.requestText !== undefined) payload.requestText = i.requestText;
  if (i.kind === 'workflow') payload.workflow = {name:i.workflow.name,issue:i.workflow.issue};
  const receipt = value => {
    if (value?.state !== 'started' || value.targetMachineId !== targetMachineId || value.startId !== startId
      || (i.kind === 'workflow' ? value.runId !== startId : !nonempty(value.sessionId))) return null;
    const fields = {};
    for (const key of ['runId','sessionId','project','launchSelection']) if (value[key] !== undefined) fields[key] = structuredClone(value[key]);
    return answer('started',null,`Started on ${i.target.name ?? targetMachineId} from ${i.repository.url} at ${i.repository.ref}.`,fields);
  };
  try {
    const reply = await port.start(payload), proved = receipt(reply);
    if (proved) return proved;
    if (reply?.state === 'refused' && reply.targetMachineId === targetMachineId && reply.startId === startId) return answer('refused',nonempty(reply.code) ? reply.code : 'target_not_eligible','The selected target refused before starting.');
  } catch { /* A lost start reply grants inspection only. */ }
  try { const proved = receipt(await port.inspect({targetMachineId,startId})); if (proved) return proved; } catch { /* Preserve uncertainty. */ }
  return answer('uncertain','uncertain','The original start is unproved. Inspect this machine and start id; do not start again.');
}
