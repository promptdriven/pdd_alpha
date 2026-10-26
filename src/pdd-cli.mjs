// Generated from prompts/cli/pdd-cli.prompt.md (sha256: f008899e8d74d404fdb2020d51a23f9b4259f9eab731e58de752c0c78a5b9556).
import { readFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync }  from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadGuidance } from './guidance.mjs';
import { launchNativeSession } from './native-session.mjs';
import { CommandInputError, parseArgv } from './argument-parser.mjs';
import { renderCompletion } from './completion.mjs';
import { PUBLIC_COMMAND_MANIFEST, PUBLIC_COMMAND_ROUTES } from './command-catalog.mjs';
import { formatLocalWorkflows } from './workflow-list.mjs';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const line = (stream, text) => stream.write(`${text}\n`);
export function renderHelp(prefix = []) {
  const route = PUBLIC_COMMAND_ROUTES.find(r=>r.prefix.length===prefix.length && r.prefix.every((w,i)=>w===prefix[i]));
  const exact = !prefix.length ? PUBLIC_COMMAND_ROUTES.find(r=>r.id==='help').rootHelp
    : route?.helpText ?? (prefix.length===1 ? PUBLIC_COMMAND_ROUTES.find(r=>r.prefix[0]===prefix[0])?.groupHelp : null);
  if(exact) return `${exact.startsWith('PDD:')?'':'PDD: prompt-driven development for your coding agent.\n\n'}${exact}\n\nWorkflow run/resume may push branches and create real PRs.\nSession and recipe shortcuts stay foreground. A Herdr pane owns each workflow controller; human waits stop it and require a current decision.\nLocal recovery reconciles eligible non-human waits. Use workflow attach RUN_ID for the actual saved active stage. Controller exit ends automatic progression.`;

  const rows = PUBLIC_COMMAND_MANIFEST.filter(({ form }) => !prefix.length
    || prefix.every((word, index) => form.slice(4).split(/\s+/)[index] === word));
  return ['PDD: prompt-driven development for your coding agent.', '',
    ...rows.map(({ form, description }) => `  ${form}  ${description}`), '',
    'Read the entire Prompting guide with pdd --skill before drafting any Story.',
    'Session and recipe shortcuts open foreground native conversations. Workflow run/resume may push branches and create real PRs.',
    'Keep the PDD controller running while its native stages work in background Herdr. After controller exit, use explicit resume to reconcile the original; no background PDD daemon continues it.',
    'Use workflow attach RUN_ID for the actual active stage; completed archives are not live sessions.'].join('\n');
}
function guidanceError(stderr) {
  line(stderr, 'The complete PDD guidance could not be read. Use a package containing the canonical guide, skill, references and manual recipes.');
  return 1;
}
async function installedSetup(runtime,home) {
  // An explicit offline owner may have no installed Runtime at all.
  if(!runtime?.versionRoot)return null;
  const root=runtime.versionRoot;
  if(dirname(root)!==join(home,'.pdd/versions')||await realpath(root)!==root)throw Error('private entry unavailable');
  const client=join(root,'client');
  try{await lstat(client);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const entry=join(client,'src/fleet/setup.mjs');
  for(const path of [home,join(home,'.pdd'),join(home,'.pdd/versions'),root,client,join(client,'src'),join(client,'src/fleet'),entry]){
    const stat=await lstat(path);
    if(await realpath(path)!==path||stat.isSymbolicLink()||(stat.mode&0o022)
      ||typeof process.getuid==='function'&&stat.uid!==process.getuid()
      ||(path===entry?(!stat.isFile()||stat.nlink!==1):!stat.isDirectory()))throw Error('private entry unavailable');
  }
  const module=await import(pathToFileURL(entry).href);
  if(typeof module.runSetupCommand!=='function')throw Error('private entry unavailable');
  return module;
}
// One public production composition root. Factories stay lazy so discovery
// cannot accidentally construct service transports or workflow authority.
export async function createPddCliPorts(ports = {}, {capability, ...options} = {}) {
  if (capability === 'models') {
    if (options.modelPorts !== undefined) return options.modelPorts;
    const {createLocalWorkflowModelPorts} = await import('./workflow-models.mjs');
    const defaults=createLocalWorkflowModelPorts({env:ports.env ?? process.env,
      ...options.localModelOptions,machineId:options.machineId,cwd:options.cwd,settings:options.settings});
    return {...defaults,...(ports.nativeCatalog!==undefined?{nativeCatalog:ports.nativeCatalog}:{}),
      ...(ports.toolDefaults!==undefined?{toolDefaults:ports.toolDefaults}:{})};
  }
  if (capability === 'projects') {
    if (options.projectPorts !== undefined) return options.projectPorts;
    const {createLocalWorkflowProjectPorts} = await import('./workflow-projects.mjs');
    return createLocalWorkflowProjectPorts({...options.localProjectOptions,machineId:options.machineId,
      cwd:options.cwd,home:ports.home,settings:options.settings,
      ...(options.workflowRecords?.readRunIndex ? {readRunIndex:options.workflowRecords.readRunIndex} : {})});
  }
  if (capability === 'controller') {
    const controller = options.workflowController ?? await import('./workflow-controller.mjs');
    return typeof controller.createLocalWorkflowControllerPorts === 'function'
      ? controller.createLocalWorkflowControllerPorts(ports) : ports;
  }
  if (capability === 'keeper') {
    if (options.workflowKeeper !== undefined) return ports;
    const keeper = await import('./workflow-keeper.mjs');
    return keeper.createWorkflowKeeperPorts(ports);
  }
  throw new Error('Unsupported CLI port capability');
}
export async function runPdd(argv, dependencies = {}) {
  const {stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, signal, cwd = process.cwd(), packageRoot = PACKAGE_ROOT,
    nativeSession = launchNativeSession, workflowRunner, workflowDefinitions, workflowStages, workflowDecider,
    phoneCli, clientAdapter = phoneCli, workflowController, workflowHerdrBoot, workflowKeeper, workflowCleaner, workflowRuntime, nativeAgentAuth,
    workflowRecords, workflowProjects, workflowModels, workflowPlacement, machinePlacement,
    machineId = 'local', home = homedir(), projectPorts, modelPorts, settings,
    updateModule, doctorModule, doctorDeps = {}, ports: suppliedPorts = {}} = dependencies;
  const ports = {...suppliedPorts,stdout,stderr,home,machinePlacement,
    ...(modelPorts??{}),...(dependencies.machineToolPolicy?{machineToolPolicy:dependencies.machineToolPolicy}:{})};
  async function localModels(selectedCwd=cwd) {
    return createPddCliPorts(ports,{...dependencies,capability:'models',machineId,cwd:selectedCwd,settings});
  }
  let localProjects;
  async function projects() {
    return localProjects??=await createPddCliPorts(ports,{...dependencies,capability:'projects',machineId,cwd,settings});
  }
  const printResult = result => {
    if (!result || !['completed','waiting','failed','recovery_required','adopted','started','refused','uncertain'].includes(result.state) || !Number.isInteger(result.exitCode) || result.exitCode<0 || result.exitCode>255
      || typeof result.message!=='string' || !result.message.trim()) throw Error('Invalid result');
    line(stdout,result.message);return result.exitCode;
  };
  const unsupported = () => {line(stderr,'This command needs an available optional client adapter; this needs the fleet client.');return 1;};
  let readyHerdrExecutable;
  async function readyHerdr(method,runtime) {
    try {
      const mod=workflowHerdrBoot??await import('./workflow-herdr-boot.mjs');
      const result=await mod[method](Object.hasOwn(runtime??{},'herdr')?{...ports,runtime}:ports);
      if(result?.state==='ready'&&result.code===null){readyHerdrExecutable=result.executable;return true;}
      if(result?.state==='unavailable'&&typeof result.message==='string'&&result.message.trim()) {
        line(stderr,safeLabel(result.message));return false;
      }
    } catch {/* Startup failures never authorize a controller or optional setup effects. */}
    line(stderr,method==='ensureHerdrInstalled'?'Herdr installation or PATH could not be confirmed. Install Herdr from https://herdr.dev/ and make herdr available on PATH, then rerun pdd setup.':'Herdr is not running and could not be started. Check Herdr and the user service, then inspect the saved run before retrying.');return false;
  }
  const safeLabel = value => String(value??'unknown').replace(/[\x00-\x1f\x7f-\x9f]/g,'');
  async function nativeLogin(agent,selectedCwd) {
    const unknown={state:'unavailable',code:'agent_auth_status_unavailable',agent};
    try {
      const owner=nativeAgentAuth??await import('./native-agent-auth.mjs');
      const result=await owner.checkNativeAgentAuth({agent,cwd:selectedCwd},ports);
      return result?.agent===agent&&((result.state==='ready'&&result.code===null)
        ||(result.state==='blocked'&&result.code==='agent_sign_in_required')
        ||(result.state==='unavailable'&&['native_agent_missing','agent_auth_status_unavailable'].includes(result.code)))?result:unknown;
    } catch {return unknown;}
  }
  function nativeLoginFailure(result) {
    const {agent,code}=result,login=agent==='codex'?'codex login':'claude auth login';
    line(stderr,code==='agent_sign_in_required'?`${agent} is not signed in. Run ${login} before starting a workflow.`
      :code==='native_agent_missing'?`${agent} is not installed. Install it and run ${login}.`
      :`${agent} sign-in status is unavailable. Check ${agent==='codex'?'codex login status':'claude auth status'} before starting a workflow.`);
  }
  async function statuses(runId, journal=true) {
    const records=workflowRecords??await import('./workflow-run-records.mjs');
    const index=await records.readRunIndex(ports);
    const entries=runId?index.entries.filter(e=>e.runId===runId):index.entries;
    const runs=[];
    for (const entry of entries) {
      let status,last;
      try {status=await records.readRunStatus(entry.runDir,ports);} catch {status={value:null,warnings:['unreadable']};}
      if(journal) {try {last=await records.readJournalLast(entry.runDir,ports);} catch {last={value:null,warnings:['unreadable']};}}
      let value=status.value;
      if(journal && (!value || !last?.value || value.journalSeq!==last.value.seq))
        value=last?.value?records.runStatusFromState(last.value.state,{phase:'journal',now:Date.now()}):null;
      runs.push({...value,runId:entry.runId,state:value?.state??'unknown',
        ...(status.warnings?.length || last?.warnings?.length?{warnings:[...(status.warnings??[]),...(last?.warnings??[])]}:{}),
        ...(index.dropped?{indexDropped:index.dropped}:{})});
    }
    return {runs,entries};
  }
  async function launchInput(plan) {
    let selectedCwd=cwd,project=null,projectEntry=null,repository=dependencies.repository??null;
    const agent=plan.options['--agent']??'codex';
    if(plan.options['--project']!==undefined) {
      const mod=workflowProjects??await import('./workflow-projects.mjs');
      const result=await mod.resolveWorkflowProject({machineId,query:plan.options['--project']},await projects());
      if(result.state!=='selected') {
        const message=result.state==='ambiguous' ? 'Choose a project: '+(result.candidates??[]).map(p=>safeLabel(`${p.name} (${p.repository?.url??p.machineId}; ${p.id})`)).join(', ')
          : result.state==='bad_args' ? 'Choose a project by name' : 'Project unavailable. Open Projects to select or explicitly clone it.';
        line(stderr,message);return {exitCode:['ambiguous','bad_args'].includes(result.state)?2:1};
      }
      projectEntry=result.project;selectedCwd=result.project.root;project={id:result.project.id,name:result.project.name};repository=result.project.repository;
    }
    const on=plan.options['--on'];
    let placement={state:'local',target:null};
    if(machinePlacement || on!==undefined) {
      let mod;
      try {mod=workflowPlacement??await import('./workflow-placement.mjs');}
      catch {
        line(stderr,on && on!=='auto'?'remote_unsupported: Remote placement unsupported without the optional client.':'Placement owner unavailable.');
        return {exitCode:1};
      }
      placement=await mod.selectStartTarget({kind:plan.local==='session'?'session':'workflow',on,sourceMachineId:machineId,agent,repository,project},ports);
      if(placement.state==='refused') {line(stderr,safeLabel(`${placement.code}: ${placement.message??placement.code}${placement.code==='remote_unsupported'?'; this needs the fleet client.':''}`));return {exitCode:1};}
    }

    const selectionOverrides={...(plan.options['--model']!==undefined?{model:plan.options['--model']}:{}),...(plan.options['--effort']!==undefined?{effort:plan.options['--effort']}:{})};
    if(placement.state==='selected') {
      const mod=workflowPlacement??await import('./workflow-placement.mjs');
      const input={kind:plan.local==='session'?'session':'workflow',target:placement.target,startId:randomUUID(),agent,repository,
        ...(project?{project}:{}),selectionOverrides,
        ...(plan.local==='session'?{requestText:plan.operands.join(' ')}:{workflow:{name:plan.operands[0],issue:plan.operands[1]}})};
      // A remote launch cannot precede the durable source request binding.
      persistStart(home,input);
      const result=await mod.dispatchStart(input,ports);
      line(result.state==='started'?stdout:stderr,safeLabel(result.message??result.code));return {exitCode:result.state==='started'?0:1};
    }
    let launchSelection=null;
    // Preserve Alpha's foreground native-default path when no capability adapter or override is supplied.
    if(modelPorts || workflowModels || settings || Object.keys(selectionOverrides).length || plan.local==='workflow-run') {
      const mod=workflowModels??await import('./workflow-models.mjs');
      const selectionPorts=await localModels(selectedCwd);Object.assign(ports,selectionPorts);
      const result=await (mod.resolveWorkflowLaunchModel??mod.resolveWorkflowModel)({machineId,agent,selection:selectionOverrides},selectionPorts);
      if(result.state!=='selected') {line(stderr,result.code==='bad_args'?'Unsupported model or effort for this machine.':'Native model catalog/defaults unavailable. Retry after the machine CLI capability adapter is available.');return {exitCode:result.code==='bad_args'?2:1};}
      if(result.warning)line(stderr,safeLabel(result.warning));
      launchSelection=result.selection;
    }
    if(projectEntry) {
      const check=(await projects()).checkLocal;
      if(await check({id:projectEntry.id,root:projectEntry.root,machineId})!==true) {line(stderr,'Project changed before launch. Select it again in Projects.');return {exitCode:1};}
    }
    return {machineId,cwd:selectedCwd,...(project?{project}:{}),...(launchSelection?{launchSelection}:{}),agent};
  }
  let plan;
  try { plan = parseArgv(argv); }
  catch (error) {
    line(stderr, error instanceof CommandInputError ? error.message : 'The command could not be parsed. Run pdd --help.');
    return 2;
  }
  switch (plan.local) {
    case 'help': line(stdout, renderHelp(plan.helpPrefix));return 0;
    case 'version':
      try { const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
        if (typeof metadata.version !== 'string' || !metadata.version) throw Error('version');
        line(stdout, metadata.version);return 0;
      } catch { line(stderr, 'This PDD package has no readable version metadata.');return 1; }
    case 'skill':
      try { line(stdout, loadGuidance({ packageRoot, cwd }));return 0; }
      catch { return guidanceError(stderr); }
    case 'workflow-run': case 'workflow-resume': case 'workflow-drive': case 'workflow-adopt': case 'workflow-attach': {
      try {
        const runner=workflowRunner??await import('./workflow-runner.mjs');
        if(plan.local==='workflow-run'&&ports.runtime){
          const {readHerdrRuntime}=await import('./workflow-herdr-executable.mjs');
          ports.runtime=await readHerdrRuntime({home,runtime:ports.runtime},ports);
        }
        const decision = {...(plan.options['--decision']?{decision:plan.options['--decision']}:{}),
          ...(plan.options['--id']?{decisionId:plan.options['--id']}:{}),
          ...(plan.options['--rev']?{expectedRev:Number(plan.options['--rev'])}:{}),
          ...(plan.options['--expect-stage']?{expect:{stage:plan.options['--expect-stage'],seq:Number(plan.options['--expect-seq'])}}:{}),
          ...(plan.options['--launch-id']?{launchId:plan.options['--launch-id']}: {})};
        const input={runId:plan.operands[0],cwd,packageRoot,...decision};
        if(['workflow-resume','workflow-drive'].includes(plan.local))Object.assign(ports,await localModels());
        if(plan.local==='workflow-adopt') return printResult(await runner.adoptWorkflow(input,ports));
        if(['workflow-drive','workflow-attach'].includes(plan.local)) {
          const stages=workflowStages??await import('./workflow-stage-herdr.mjs');
          for(const name of ['runHerdrStage','inspectHerdrStage','attachHerdrStage','closeHerdrStage','resumeHerdrStage']) {
            if(typeof stages[name]!=='function') throw Error();ports[name]=stages[name];
          }
        }
        Object.assign(ports,{loadGuidance,launchNativeSession:nativeSession});
        if(plan.local==='workflow-drive') {
          if(ports.processStartIdentity===undefined){const {readProcessStartIdentity}=await import('./workflow-herdr-client.mjs');ports.processStartIdentity=spec=>readProcessStartIdentity(spec,ports);}
          return printResult(await runner.driveWorkflow(input,ports));
        }
        if(plan.local==='workflow-attach') return printResult(await runner.attachWorkflow(input,ports));
        const {traceHerdrRequest}=await import('./herdr-trace.mjs');
        let prepared;
        if(plan.local==='workflow-run') {
          const launch=await launchInput(plan); if(launch.exitCode!==undefined) return launch.exitCode;
          if(!workflowRunner||nativeAgentAuth){
            const auth=await nativeLogin(launch.agent,launch.cwd);
            if(auth.state!=='ready'){nativeLoginFailure(auth);return 1;}
          }
          const request={name:plan.operands[0],issue:plan.operands[1],packageRoot,...launch};
          prepared=await traceHerdrRequest({operation:'workflow.prepare',request},()=>runner.prepareWorkflow(request,ports),ports);
        } else prepared=await traceHerdrRequest({operation:'workflow.resume',request:input},()=>runner.resumeWorkflow(input,ports),ports);
        if(prepared?.state!=='prepared') return printResult(prepared);
        if((!workflowController||workflowHerdrBoot)&&!await readyHerdr('ensureDefaultHerdr',prepared.runtime))return 1;
        const controller=workflowController??await import('./workflow-controller.mjs');
        const launchPorts=prepared.runtime?.herdr===undefined?ports:{...ports,runtime:prepared.runtime};
        const controllerPorts=await createPddCliPorts(launchPorts,{capability:'controller',workflowController:controller});
        const controllerInput={...prepared,decision:plan.options['--decision']?{decision:decision.decision,id:decision.decisionId,rev:decision.expectedRev,...(decision.expect?{expectStage:decision.expect.stage,expectSeq:decision.expect.seq}:{})}:null};
        const result=await traceHerdrRequest({operation:'controller.start',request:controllerInput},()=>controller.startWorkflowController(controllerInput,controllerPorts),controllerPorts);
        const started=result?.state==='started';
        if(started) line(stdout,`Started workflow ${prepared.runId}.`);
        else {
          const state=safeLabel(result?.state)||'unknown';
          const code=result?.code===null?'null':safeLabel(result?.code)||'unknown';
          const missing=Array.isArray(result?.missingPorts)?result.missingPorts.filter(name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_.]*$/.test(name)):[];
          const missingHerdr=['herdr_not_found','launch_budget'].includes(result?.code)&&typeof result.message==='string'?` ${safeLabel(result.message)}.`:'';
          const identityMessage=result?.code==='herdr_identity_unavailable'?' Herdr process identity is unavailable for the new controller pane. No controller command was sent.':'';
          line(stderr,!['refused','failed'].includes(result?.state)
            ?`Workflow controller may be running: ${state} (${code}).${missingHerdr} Check pdd workflow status ${prepared.runId}.`
            :`Workflow controller not started: ${state} (${code}).${missingHerdr}${identityMessage}${missing.length?` Missing ports: ${missing.join(', ')}.`:''} Inspect the saved run before retrying.`);
        }
        return started?0:1;
      } catch {line(stderr,'The local workflow operation could not be confirmed. Inspect saved state before retrying.');return 1;}
    }
    case 'workflow-status': case 'status': {
      try {
        if(plan.local==='status' && clientAdapter?.runStatusCommand) {const value=await clientAdapter.runStatusCommand(argv.slice(1),{...ports,cwd,packageRoot});if(!Number.isInteger(value)||value<0||value>255)throw Error();return value;}
        const runId=plan.local==='workflow-status'?plan.operands[0]:undefined;
        const {runs}=await statuses(runId,plan.local==='workflow-status');
        if(runId && !runs.length) {line(stdout,plan.options['--json']?JSON.stringify({v:1,runId,state:'unknown',message:'Run not found'}):'Run not found');return 1;}
        if(plan.options['--json']) line(stdout,JSON.stringify(runId?{...runs[0],v:1}:{v:1,runs}));
        else {
          if(plan.local==='status') line(stdout,'Needs you: '+(runs.filter(r=>r.waitingPerson || r.runtimeNotice).map(r=>safeLabel(`${r.runId} rev ${r.rev}: ${r.waitingPerson?.what??r.runtimeNotice?.message??'Review run'}`)).join('; ')||'None'));
          for(const run of runs) line(stdout,safeLabel(`${run.project?.name??run.workflow??run.runId}: ${run.state}; machine ${run.machineId??'unknown'}; step ${run.stage?.id??'unknown'}; rev ${run.rev??'unknown'}; age ${Number.isFinite(run.updatedAt)?Math.max(0,Date.now()-run.updatedAt)+'ms':'unknown'}; version ${run.runtime?.pddVersion??'unknown'}; account ${run.actualAccount?.label??run.actualAccount?.id??'unknown'}; model ${run.effectiveSelection?.model??run.launchSelection?.model??'unknown'}; effort ${run.effectiveSelection?.effort??run.launchSelection?.effort??'none'}; ${run.waitingPerson?.what??run.waitingFor?.what??run.message??''}`));
          if(!runs.length) line(stdout,'No saved runs.');
        }
        return 0;
      }catch {line(stderr,'Saved run status is unavailable. Retry after checking local records.');return 1;}
    }
    case 'workflow-clean': {
      try {const mod=workflowCleaner??await import('./workflow-clean.mjs');
        const result=await mod.cleanWorkflowRuns({cwd,now:Date.now(),dryRun:plan.options['--dry-run']===true},ports);
        if(!Array.isArray(result?.removed)||!Array.isArray(result?.retained)) throw Error();
        for(const [kind,rows] of [['Removed',result.removed],['Retained',result.retained]]) for(const value of rows) line(stdout,`${kind}: ${safeLabel(typeof value==='string'?value:JSON.stringify(value))}`);
        for(const warning of result.warnings??[]) line(stderr,safeLabel(warning));return 0;
      }catch {line(stderr,'Run cleanup could not be confirmed. Inspect local runs before retrying.');return 1;}
    }
    case 'workflow-upgrade': {
      try {const {runs,entries}=await statuses(plan.operands[0]);if(!runs.length) {line(stderr,'Run not found');return 1;}
        const old=runs[0],target=dependencies.upgradeTarget?await dependencies.upgradeTarget():await (await import('./versions.mjs')).resolveRuntime({home});
        if(!target || !Number.isSafeInteger(old.rev) || old.rev<1) {line(stderr,'A verified target runtime and current stopped revision are required.');return 1;}
        line(stdout,`Upgrade run rev ${old.rev}: ${safeLabel(old.runtime?.releaseId)} -> ${safeLabel(target.releaseId)}`);
        if(await (dependencies.confirmUpgrade??confirmRuntimeUpgrade)({old:old.runtime,target,expectedRev:old.rev,stdout,stderr})!==true) {line(stdout,'Upgrade cancelled.');return 0;}
        const mod=workflowRuntime??await import('./workflow-runtime.mjs');
        const result=await mod.upgradeWorkflowRuntime({runDir:entries[0].runDir,expectedRev:old.rev,target},ports);
        line(result.state==='upgraded'?stdout:stderr,safeLabel(result.state==='upgraded'?'Run runtime upgraded.':result.code));return result.state==='upgraded'?0:1;
      }catch {line(stderr,'Run runtime upgrade could not be confirmed. Inspect the saved run.');return 1;}
    }
    case 'runs-keeper': {
      try {const mod=workflowKeeper??await import('./workflow-keeper.mjs');
        const keeperPorts=await createPddCliPorts(ports,{capability:'keeper',workflowKeeper,workflowController});
        const result=await mod.runWorkflowKeeper({home},keeperPorts);
        if(Number.isInteger(result))return result;
        if(Number.isInteger(result?.exitCode) && !result.message)return result.exitCode;
        if(result?.message)return printResult(result);
        if(result && Array.isArray(result.results)) {for(const row of result.results) line(stdout,safeLabel(row.message??row.state));return result.results.some(r=>['failed','recovery_required'].includes(r.state))?1:0;}
        throw Error();
      }catch {line(stderr,'Local run recovery is unavailable. Inspect saved recovery records.');return 1;}
    }
    case 'workflow-decide': {
      try {
        const decider = workflowDecider ?? await import('./workflow-decide.mjs');
        if (typeof decider.decideWorkflow !== 'function') throw Error('Missing decision module');
        const result = await decider.decideWorkflow({runId:plan.operands[0], decision:plan.options['--decision'], decisionId:plan.options['--id'], ...(plan.options['--rev']?{expectedRev:Number(plan.options['--rev'])}:{}), ...(plan.options['--expect-stage']?{expectStage:plan.options['--expect-stage'],expectSeq:Number(plan.options['--expect-seq'])}:{}), cwd, packageRoot}, ports);
        if (!result || !['recorded','started','refused','uncertain','failed'].includes(result.state) || !Number.isInteger(result.exitCode)) throw Error('Invalid decision reply');
        if (plan.options['--json']) line(stdout, JSON.stringify({...result, exitCode:undefined, v:1}, (_,v)=>v===undefined?undefined:v));
        else line(stdout, result.message);
        return result.exitCode;
      } catch { line(stderr, 'The workflow decision could not be confirmed. Inspect the saved intent before repeating it.'); return 1; }
    }
    case 'setup': {
      try {
        const modules=dependencies.setupModules??{};
        const versions=modules.versions??await import('./versions.mjs');
        const lock=modules.lock??await import('./update-lock.mjs');
        const launcher=modules.launcher??await import('./pdd-launch.mjs');
        let runtime=await versions.resolveRuntime({home,versionRoot:packageRoot},ports);
        if(!dependencies.setupModules||nativeAgentAuth){
          const checks=[];
          for(const agent of ['codex','claude'])checks.push(await nativeLogin(agent,cwd));
          const failure=checks.find(result=>result.state!=='ready'&&result.code!=='native_agent_missing')
            ??(!checks.some(result=>result.state==='ready')?checks[0]:null);
          if(failure){nativeLoginFailure(failure);return 1;}
        }
        if(!await readyHerdr('ensureHerdrInstalled'))return 1;
        const herdrService=modules.herdrService??(!dependencies.setupModules?await import('./workflow-herdr-service.mjs'):null);
        const result=await lock.withUpdateLock({home},async lease=>{
          const binding=modules.herdrRuntime??await import('./workflow-herdr-executable.mjs');
          runtime=await binding.recordHerdrRuntime({home,runtime,herdr:readyHerdrExecutable,lease},ports);
          if(herdrService){const service=await herdrService.provisionHerdrService({home,runtime,lease},ports);if(service?.code!==null)return service;}
          const support=await launcher.installLauncherSupport({home,runtime,lease},ports);
          if(support?.code!==null)return support;
          return launcher.provisionRecoveryService({home,runtime,lease},ports);
        },ports);
        if(result?.code!==null){if(result?.code==='herdr_service_unavailable'||result?.code==='herdr_not_found'){line(stderr,safeLabel(result.message));return 1;}throw Error();}
        if(herdrService&&!await readyHerdr('ensureDefaultHerdr',runtime))return 1;
        if(clientAdapter?.runSetupCommand) {
          const exit=await clientAdapter.runSetupCommand(argv.slice(1),{...ports,cwd,packageRoot});
          if(!Number.isInteger(exit)||exit<0||exit>255)throw Error();return exit;
        }
        if(clientAdapter===undefined){
          let client;
          try{client=await installedSetup(runtime,home);}catch{return unsupported();}
          if(client){
            try{
              const exit=await client.runSetupCommand(argv.slice(1),{home,linkDir:join(home,'.pdd/link'),stdin,stdout,stderr,signal});
              if(!Number.isInteger(exit)||exit<0||exit>255)throw Error();return exit;
            }catch{line(stderr,'Optional client command unconfirmed. Inspect local state before retrying.');return 1;}
          }
        }
        line(stdout,'Public recovery service ready.');return 0;
      }catch(error) {if(error?.code==='herdr_not_found'){line(stderr,safeLabel(error.message));return 1;}line(stderr,'Public setup could not be completed. Use the verified PDD installer or ~/.pdd/launcher/pdd-launch recover, then rerun pdd setup.');return 1;}
    }
    case 'doctor': {
      try {const mod=doctorModule??await import('./doctor.mjs');const exitCode=await mod.runDoctorCommand(argv.slice(1),{...(clientAdapter?.doctorChecks?{clientAdapter}:{}),home,...doctorDeps,cwd,packageRoot,stdout,stderr});if(![0,1,2].includes(exitCode))throw Error();return exitCode;}
      catch {line(stderr,'Public diagnostics unavailable. Check the selected package.');return 1;}
    }
    case 'projects': case 'models': {
      try {
        const target=plan.options['--on']??machineId;
        if(target!==machineId && !(plan.local==='projects'?projectPorts:modelPorts))return unsupported();
        if(plan.local==='projects') {const mod=workflowProjects??await import('./workflow-projects.mjs');const result=await mod.listWorkflowProjects({machineId:target},await projects());
          if(!result.projects.length) line(stdout,'No projects found');
          for(const p of result.projects) line(stdout,safeLabel(`${p.name} (${p.id}) — ${p.availability}; ${p.sources.join(', ')}`));
          for(const w of result.warnings??[]) line(stderr,`Project source ${safeLabel(w.source)}: ${safeLabel(w.code)}`);return 0;
        }
        const mod=workflowModels??await import('./workflow-models.mjs');const result=await mod.listWorkflowModels({machineId:target,agent:plan.options['--agent']},await localModels());
        if(result.state!=='listed') {line(stderr,'Model catalog unavailable. Retry after checking the target CLI adapter.');return 1;}
        for(const m of result.catalog.models) line(stdout,safeLabel(`${m.label} (${m.id}): ${m.efforts.join(', ')||'no effort control'}; machine ${result.catalog.machineId}`));return 0;
      }catch {line(stderr,'Local discovery unavailable. Check the machine source adapter.');return 1;}
    }
    case 'settings': {
      try {if(!settings)return unsupported();const target=plan.options['--machine']??machineId,agent=plan.options['--tool'];
        if(!plan.operands.length) {const value=await settings.read({machineId:target,agent});line(stdout,safeLabel(JSON.stringify(value)));return 0;}
        const [key,value]=plan.operands;let selection;
        if(['model','effort'].includes(key)) {const mod=workflowModels??await import('./workflow-models.mjs');const result=await mod.resolveWorkflowModel({machineId:target,agent,selection:{[key]:value}},await localModels());
          if(result.state!=='selected') {line(stderr,'Settings model/effort pair unavailable or unsupported.');return result.code==='bad_args'?2:1;}selection={model:result.selection.model,effort:result.selection.effort};}
        const result=await settings.write({machineId:target,agent,key,value,...(selection?{selection}:{})});
        if(result?.ok!==true) {line(stderr,'Settings change unconfirmed. Inspect machine Settings.');return 1;}
        line(stdout,'Settings updated.');return 0;
      }catch {line(stderr,'Machine Settings unavailable. Check the settings adapter.');return 1;}
    }
    case 'update': {
      const action=Object.keys(plan.options).find(k=>!['--fleet','--force'].includes(k));
      const input={action:action?.slice(2)??null,value:action && plan.options[action]!==true?plan.options[action]:null,fleet:!!plan.options['--fleet'],force:!!plan.options['--force']};
      const plainShow=input.action===null&&!input.fleet;
      try {const mod=updateModule??await import('./update-command.mjs');
        const result=await mod.runUpdateCommand(input,ports);
        if(!result || ![0,1,2].includes(result.code) || typeof result.message!=='string' || !result.message.trim())throw Object.assign(new Error(),{code:'update_invalid_result'});
        if(plainShow&&result.code!==0){const local=await import('./update-command.mjs');const status=await local.runUpdateCommand({},ports);line(stdout,status.message);line(stderr,safeLabel(result.message));return 0;}
        line(result.code===0?stdout:stderr,result.message);return result.code;
      }catch(error) {
        const reasons={ENOENT:'A required update file is missing.',ERR_MODULE_NOT_FOUND:'The release selector is not installed.',EACCES:'Permission to read local update state was denied.',EPERM:'Permission to read local update state was denied.',ENOTFOUND:'The release host could not be reached.',ECONNREFUSED:'The release host refused the connection.',ETIMEDOUT:'The release check timed out.',update_invalid_result:'The update adapter returned an invalid result.'};
        const reason=reasons[error?.code]??'The update adapter failed; its result could not be confirmed.';
        if(plainShow){const local=await import('./update-command.mjs');const result=await local.runUpdateCommand({},ports);line(stdout,result.message);line(stderr,reason+' Run pdd doctor.');return 0;}
        line(stderr,reason+' No update was confirmed. Run pdd doctor before changing the installation.');return 1;
      }
    }
    case 'session': {
      let launch;
      try {launch=await launchInput(plan);if(launch.exitCode!==undefined)return launch.exitCode;}
      catch {line(stderr,'Launch selection unavailable. Check the local adapters.');return 1;}
      let context;
      try { context = loadGuidance({ packageRoot, cwd: launch.cwd, workflows: true, workflowName: plan.workflowName }); }
      catch { return guidanceError(stderr); }
      return nativeSession({ agent: launch.agent, cwd: launch.cwd, context, ...(launch.launchSelection?{selection:launch.launchSelection}:{}),
        request: plan.operands.join(' '), stderr });
    }
    case 'completion': stdout.write(renderCompletion(plan.operands[0]));return 0;
    case 'workflow-list':
      try {
        const definitions=workflowDefinitions??await import('./workflow-definition-loader.mjs');
        const workflows=await definitions.listWorkflowDefinitions({cwd,packageRoot});
        if (!Array.isArray(workflows)) throw Error('Invalid definition listing');
        line(stdout,formatLocalWorkflows({workflows,default:null},{json:plan.options['--json']===true}));return 0;
      } catch { line(stderr,'Workflow definitions could not be read or validated. Check the selected project definitions and bundled package.');return 1; }
    default: {
      try {
        const family=plan.commandId.split('.')[0];
        const binding={phone:'runPhoneCommand',link:'runLinkCommand',fleet:'runFleetCommand',agents:'runAgentCommand',agent:'runAgentCommand',open:'runAgentCommand',accounts:'runAccountsCommand',setup:'runSetupCommand',join:'runJoinCommand'}[family];
        if(!binding || typeof clientAdapter?.[binding]!=='function') return unsupported();
        const raw=['agents','agent','open'].includes(family)?argv:argv.slice(1);
        const result=await clientAdapter[binding](raw,{...ports,cwd,packageRoot});
        if(!Number.isInteger(result)||result<0||result>255)throw Error();return result;
      }catch {line(stderr,'Optional client command unconfirmed. Inspect local state before retrying.');return 1;}
    }
  }
}

function persistStart(home,input) {
  const directory=join(home,input.kind==='session'?'.pdd/sessions/starts':'.pdd/runs/starts');mkdirSync(directory,{recursive:true,mode:0o700});
  const fd=openSync(join(directory,`${input.startId}.json`),'wx',0o600);
  try {writeSync(fd,JSON.stringify({v:1,...input})+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  const dir=openSync(directory,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}

async function confirmRuntimeUpgrade({stdout,stderr}) {
  if(!process.stdin.isTTY) {line(stderr,'Run workflow upgrade interactively to review and confirm this transition.');return false;}
  const {createInterface}=await import('node:readline/promises');
  const terminal=createInterface({input:process.stdin,output:stdout});
  try {return (await terminal.question('Record this stopped run runtime upgrade? [y/N] ')).trim().toLowerCase()==='y';}
  catch {return false;} finally {terminal.close();}
}
