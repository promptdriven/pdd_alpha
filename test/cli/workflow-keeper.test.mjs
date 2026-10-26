import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import vectors from '../../vectors/cli/workflow-keeper.json' with {type:'json'};
import {reconcileWorkflowControllers,runWorkflowKeeper,discoverWorkflowRuns,restoreManagedWorkflowSession} from '../../src/workflow-keeper.mjs';
import {runId,folder,fakeLocks} from './runner-a-fixtures.mjs';
function fixture(){
  const entries=[{runId,runDir:`/saved/pdd/workflows/${runId}`,root:'/assigned'}],state={runId,controlState:'running',name:'feature',root:'/assigned',runtime:{releaseId:'old'},issue:{number:7}},launches=[],calls=[];
  let time=30000;
  const ports={observations:new Map(),validateLocator:async()=>true,readWorkflowJournal:async()=>({state,seq:1}),observeHerdr:async()=>({upSince:0,stableSince:0,complete:true}),inspectWorkflowLock:async()=> 'free',readControllerLaunches:async()=>launches,checkWorkflowRuntime:async()=>({ok:true}),startWorkflowController:async spec=>{calls.push(spec);return {state:'started',code:null};}};
  return {entries,state,launches,calls,ports,pass:async(now=time)=>{time=now;return reconcileWorkflowControllers({entries,now},ports);}};
}
for(const priorIntent of [true,false])test(`keeper preserves known missing-path controller message and state, priorIntent=${priorIntent}`,async()=>{
 const f=fixture(),message='Herdr not found at /saved/runtime/herdr',calls=[];
 if(priorIntent)f.launches.push({admittedAt:1000,phase:'pane.run.intent',decision:null});
 f.ports.startWorkflowController=async spec=>{calls.push(spec);return {state:'uncertain',code:'herdr_not_found',message};};
 await f.pass(30000);const result=await f.pass(60000);
 assert.deepEqual(result,[{runId,state:'uncertain',code:'herdr_not_found',message,...(priorIntent?{inspectOriginal:true}:{})}]);
 assert.equal(calls.length,1);assert.equal(calls[0].runtime,f.state.runtime);
 assert.equal(Object.hasOwn(calls[0],'decision'),priorIntent);
});
test('keeper does not forward arbitrary controller error text',async()=>{
 const f=fixture();f.ports.startWorkflowController=async()=>({state:'uncertain',code:'launch_uncertain',message:'untrusted raw diagnostic'});
 await f.pass(30000);const [result]=await f.pass(60000);
 assert.equal(result.state,'uncertain');assert.equal(result.code,'launch_uncertain');assert.equal(Object.hasOwn(result,'message'),false);
});
for(const c of vectors.cases)test(`keeper vector: ${c.id}`,async t=>{
  const f=fixture();
  switch(c.id){
    case 'human-wait':case 'fixed-quota-stays-stopped':f.state.controlState='waiting_person';f.state.waitingPerson={origin:'quota'};break;
    case 'question-lost':f.state.controlState='question_lost';break;
    case 'budget-boundary':for(let i=0;i<3;i++)f.launches.push({admittedAt:1000,phase:'exited'});break;
    case 'uncertain-launch':f.launches.push({admittedAt:1000,phase:'pane.run.intent',decision:null});f.ports.startWorkflowController=async spec=>{assert.equal(spec.decision,null);return {state:'uncertain',code:'launch_uncertain'};};break;
    case 'quota-observation':f.state.controlState='WAIT';f.state.quota={until:1000};f.ports.observeQuota=async()=>{throw Error('network failure');};break;
    case 'legacy-unadopted':f.state.adopted=false;delete f.state.controlState;break;
    case 'unstable-herdr':f.ports.observeHerdr=async()=>({upSince:60000-c.given.herdrUpSeconds*1000,stableSince:60000-c.given.stableServerSeconds*1000,complete:true});break;
    case 'nonmanaged-command-pass-through':assert.deepEqual(await restoreManagedWorkflowSession({},{}),{state:'unmanaged'});return;
    case 'managed-restore':assert.equal((await restoreManagedWorkflowSession({launchId:runId,generation:3},{readManagedLaunch:async()=>({launchId:runId,generation:4})})).state,'retired');return;
    case 'public-runs-keeper-service':{
      const home=await folder(t),abort=new AbortController(),intervals=[];let active=0;
      const p={...f.ports,signal:abort.signal,acquireLock:fakeLocks(),wait:async ms=>{intervals.push(ms);assert.equal(active,0);abort.abort();},fs:{...fs,readdir:async()=>{active++;await Promise.resolve();active--;return [];}}};
      assert.equal((await runWorkflowKeeper({home},p)).exitCode,0);assert.deepEqual(intervals,[30000]);return;
    }
    case 'service-owner-contention':{
      const home=await folder(t),abort=new AbortController(),p={signal:abort.signal,acquireLock:async()=>({state:'busy'}),startWorkflowController:()=>assert.fail()};
      assert.equal((await runWorkflowKeeper({home},p)).state,c.expected.secondOwnerResult);return;
    }
    case 'restore-policy-revision':f.state.machineToolPolicy={revision:8,targetAccountId:'b'};break;
  }
  await f.pass(30000);const r=await f.pass(c.id==='one-free-check'?59999:60000);
  if(c.expected.driveLaunches!==undefined)assert.equal(f.calls.length,c.expected.driveLaunches,c.id);
  if(c.expected.controllerStarted===false)assert.equal(f.calls.length,0);
  if(c.expected.needsYou)assert.equal(r[0].state,'needs_you');
  if(c.expected.inspectOriginal)assert.equal(r[0].inspectOriginal,true);
  if(c.expected.retryObservation)assert.equal(r[0].retryObservation,true);
  if(c.id==='restore-policy-revision'){assert.equal(f.calls.length,1);assert.equal(f.calls[0].runtime.releaseId,'old');assert.equal('accountId' in f.calls[0],false);}
  if(c.id==='alpha-only'||c.id==='restart-after-death')assert.equal(f.calls[0].decision,undefined);
});
test('discovery includes registry when display append was lost and warns on corruption',async t=>{
  const home=await folder(t),dir=join(home,'.pdd','runs','registry');await fs.mkdir(dir,{recursive:true});
  const entry={v:1,runId,commonDir:'/repo/.git',root:'/assigned',runDir:`/repo/.git/pdd/workflows/${runId}`};
  await fs.writeFile(join(dir,`${runId}.json`),JSON.stringify(entry));await fs.writeFile(join(dir,'bad.json'),'{');
  const r=await discoverWorkflowRuns({home});assert.deepEqual(r.entries,[entry]);assert.ok(r.warnings.some(w=>w.startsWith('registry_invalid')));
});
test('blocked question, unknown lock and corrupt journal never relaunch',async()=>{
  for(const mode of ['blocked','unknown','damaged']){
    const f=fixture();if(mode==='blocked')f.state.pending={backend:{agentStatus:'blocked'}};
    if(mode==='unknown')f.ports.inspectWorkflowLock=async()=> 'unknown';
    if(mode==='damaged')f.ports.readWorkflowJournal=async()=>{throw Error('damaged');};
    await f.pass(30000);await f.pass(60000);assert.equal(f.calls.length,0);
  }
});
test('quota due is observation-only until a fresh room answer',async()=>{const f=fixture();f.state.controlState='WAIT';f.state.quota={until:1000};f.ports.observeQuota=async()=>({fresh:true,room:true});await f.pass(30000);await f.pass(60000);assert.equal(f.calls.length,1);});
test('a missing recovery registry stays visible through the index but cannot launch',async t=>{
  const home=await folder(t),dir=join(home,'.pdd','runs');await fs.mkdir(dir,{recursive:true});const entry={runId,runDir:`/saved/pdd/workflows/${runId}`,root:'/assigned'};await fs.writeFile(join(dir,'index.jsonl'),JSON.stringify(entry)+'\n');
  const discovered=await discoverWorkflowRuns({home});assert.equal(discovered.entries.length,1);assert.ok(discovered.warnings.includes(`registry_missing_or_invalid:${runId}`));
  const f=fixture();const r=await reconcileWorkflowControllers({entries:discovered.entries,now:60000},f.ports);assert.equal(r[0].code,'registry_missing_or_invalid');assert.equal(f.calls.length,0);
});
test('managed restore reconciles policy through its owner before acquiring the native claim',async()=>{
  const events=[],record={launchId:runId,generation:4,kind:'codex',nativeSessionId:'9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',runtime:{releaseId:'old'},flags:['--saved-flag'],managedAccount:true};
  const ports={readManagedLaunch:async()=>record,validateManagedRuntime:async()=>true,validateManagedFlags:async()=>true,accountAdapter:{reconcileRestore:async()=>{events.push('policy');return {ready:true};}},validateOwner:async()=>({state:'current'}),acquireLock:async()=>{events.push('claim');return {state:'owned',release:async()=>{}};},restoreNative:async(actual,claim)=>{events.push('restore');assert.equal(actual.runtime.releaseId,'old');await claim.release();return {state:'restored'};}};
  assert.equal((await restoreManagedWorkflowSession({launchId:runId,generation:4},ports)).state,'restored');assert.deepEqual(events,['policy','claim','restore']);
  ports.accountAdapter.reconcileRestore=async()=>({ready:false,code:'fixed_full'});ports.acquireLock=()=>assert.fail('fixed quota question cannot claim or restore');assert.equal((await restoreManagedWorkflowSession({launchId:runId,generation:4},ports)).code,'fixed_full');
});

import {createWorkflowHerdrPorts} from '../../src/workflow-herdr-client.mjs';

test('C18 working-agent churn cannot starve killed-controller recovery or duplicate its stage prompt',async()=>{
  const f=fixture(),before=structuredClone(f.state),rows=[];let now=0,lock='free',activity=0;
  const boot='123e4567-e89b-42d3-a456-426614174000';
  const transport=await createWorkflowHerdrPorts({herdrExecutable:process.execPath,platform:'linux',env:{PATH:'',PDD_TRACE:''},herdrObservationNow:()=>now,
    fs:{readFile:async p=>p==='/proc/net/unix'?'x: 2 0 00010000 0001 01 77 /synthetic/herdr.sock\n':p.endsWith('boot_id')?boot:`${Number(p.split('/')[2])} (synthetic) S ${Array(18).fill('0').join(' ')} 987 0\n`,readdir:async p=>p==='/proc'?['321']:['4'],readlink:async()=> 'socket:[77]'},
    execFile:async(file,args)=>{
      assert.equal(file,process.execPath);assert.deepEqual(args.slice(0,2),['--session','default']);
      // Synthetic counterpart of the recorded unsettled -> observing ->
      // unsettled cycle: the same live stage changes foreground children.
      if(args[2]==='pane'&&args[3]==='list')return {stdout:JSON.stringify({result:{panes:[{pane_id:'w1:p7'}]}})};
      if(args[2]==='pane'&&args[3]==='process-info')return {stdout:JSON.stringify({result:{process_info:{pane_id:'w1:p7',shell_pid:50,foreground_processes:[{pid:now<60000?400:401,argv:['/synthetic/agent']}]}}})};
      assert.deepEqual(args,['--session','default','status','--json']);
      return {stdout:JSON.stringify({server:{running:true,status:'running',session:null,socket:'/synthetic/herdr.sock'},activity:++activity})};}});
  f.ports.observeHerdr=transport.observeHerdr;
  f.ports.inspectWorkflowLock=async()=>lock;
  f.ports.appendKeeperDecision=async row=>rows.push(row);
  f.ports.startWorkflowController=async spec=>{f.calls.push(spec);lock='held';return {state:'started',code:null};};
  for(now of [0,30000,60000,90000])await f.pass(now);
  assert.deepEqual(rows.map(r=>r.code),['herdr_unsettled','observing_lock',null,'controller_busy']);
  assert.equal(f.calls.length,1,'one recorded-controller admission after two free-lock observations');
  assert.equal(f.calls[0].runtime,f.state.runtime);assert.equal(f.calls[0].decision,undefined);
  assert.deepEqual(f.state,before,'recovery observation changes no saved stage or prompt intent');
  assert.equal(activity,8,'each pass proves the same server around repeated status reads');
});

test('C18 unsettled observation retains a free-lock memo only for the same proved server',async()=>{
  const f=fixture(),server={pid:321,startIdentity:'boot:987'};
  let stableSince=0;f.ports.observeHerdr=async()=>({complete:true,upSince:0,stableSince,server});
  assert.equal((await f.pass(30000))[0].code,'observing_lock');const first=f.ports.observations.get(runId);
  stableSince=50000;assert.equal((await f.pass(60000))[0].code,'herdr_unsettled');
  assert.equal(f.ports.observations.get(runId),first);assert.equal(f.calls.length,0);
  assert.equal((await f.pass(80000))[0].state,'started');assert.equal(f.calls.length,1);
});

test('C18 restart, unknown server, backward time and a held lock invalidate the free-lock observation',async()=>{
  for(const mode of ['restart','missing','unproved','backward','held']){
    const f=fixture();let server={pid:321,startIdentity:'boot:987'},complete=true;
    f.ports.observeHerdr=async()=>({complete,upSince:0,stableSince:0,server});await f.pass(30000);
    if(mode==='restart')server={pid:321,startIdentity:'boot:988'};
    if(mode==='missing')server={pid:321};
    if(mode==='unproved')complete=false;
    if(mode==='held')f.ports.inspectWorkflowLock=async()=> 'held';
    await f.pass(mode==='backward'?20000:60000);assert.equal(f.calls.length,0,mode);
    if(mode==='restart')assert.equal(f.ports.observations.get(runId).at,60000);
    else assert.equal(f.ports.observations.has(runId),false,mode);
  }
});

for(const middleLock of ['held','unknown','error','free'])test(`C18 unsettled lock continuity: ${middleLock}`,async()=>{
  const f=fixture(),saved=structuredClone(f.state),server={pid:321,startIdentity:'boot:987'},inspections=[],decisions=[];
  let now=30000,stableSince=0,lock='free';
  f.ports.observeHerdr=async()=>({complete:true,upSince:0,stableSince,server});
  f.ports.inspectWorkflowLock=async spec=>{
    assert.equal(spec.path,join(f.entries[0].runDir,'controller.lock'));
    inspections.push({now,lock});if(lock==='error')throw Error('lock inspection failed');return lock;
  };
  f.ports.appendKeeperDecision=async row=>decisions.push(row);
  const pass=at=>{now=at;return f.pass(at);};
  assert.equal((await pass(30000))[0].code,'observing_lock');
  const first=f.ports.observations.get(runId);
  stableSince=50000;lock=middleLock;
  assert.equal((await pass(60000))[0].code,middleLock==='error'?'recovery_inspection_failed':'herdr_unsettled');
  assert.equal(f.calls.length,0,'an unsettled pass never launches');
  assert.deepEqual(inspections,[{now:30000,lock:'free'},{now:60000,lock:middleLock}]);
  assert.equal(decisions.at(-1).controller,middleLock==='free'?'absent':middleLock==='held'?'held':'unknown');
  assert.equal(f.ports.observations.has(runId),middleLock==='free');
  if(middleLock==='free')assert.equal(f.ports.observations.get(runId),first);
  lock='free';const [settled]=await pass(80000);
  if(middleLock==='free'){
    assert.equal(settled.state,'started');assert.equal(f.calls.length,1);
  }else{
    assert.equal(settled.code,'observing_lock');assert.equal(f.calls.length,0);
    assert.equal(f.ports.observations.get(runId).at,80000);
    assert.equal((await pass(109999))[0].code,'observing_lock');assert.equal(f.calls.length,0);
    assert.equal((await pass(110000))[0].state,'started');assert.equal(f.calls.length,1);
  }
  assert.equal(f.calls[0].runtime,f.state.runtime);
  assert.deepEqual(f.state,saved,'lock observations cannot change the saved stage or prompt intent');
});


test('C21 keeper exempts planned history and preserves budget reset through original-intent reconciliation',async()=>{
 const f=fixture();f.launches.push({admission:1,admittedAt:1000,decision:null,phase:'exited'},{admission:2,admittedAt:2000,decision:{decision:'approve',id:runId,rev:2},phase:'exited'},{admission:3,admittedAt:3000,decision:{decision:'approve',id:runId,rev:3},phase:'exited'});
 await f.pass(30000);assert.equal((await f.pass(60000))[0].state,'started');assert.equal(f.calls.length,1);
 for(const pending of [false,true]){
  const g=fixture();g.launches.push(...[1000,2000,3000].map(admittedAt=>({admittedAt,phase:'exited'})));
  if(pending){g.launches[2].phase='pane.run.intent';g.ports.startWorkflowController=async()=>({state:'refused',code:'launch_budget',resetAt:3601000,message:'Retry available at 1970-01-01T01:00:01.000Z.'});}
  await g.pass(30000);const row=(await g.pass(60000))[0];assert.equal(row.state,'needs_you');assert.equal(row.code,'launch_budget');assert.equal(row.resetAt,3601000);assert.match(row.message,/1970-01-01T01:00:01.000Z/);
  if(pending)assert.equal(row.inspectOriginal,true);else assert.equal(g.calls.length,0);
 }
});

test('C20 absent server needs the person and clears prior continuity without launching',async()=>{
 const f=fixture();const rows=[];f.ports.appendKeeperDecision=async row=>{rows.push(row);return {ok:true};};
 await f.pass(30000);
 f.ports.observeHerdr=async()=>({complete:false,code:'herdr_not_found',reason:'server_absent',message:'Herdr is not running. Run pdd setup to start the Herdr service, then inspect pdd workflow status before resuming the saved run.'});
 const [row]=await f.pass(60000);assert.equal(row.state,'needs_you');assert.equal(row.code,'herdr_not_found');assert.match(row.message,/Herdr is not running.*pdd setup/);assert.equal(row.reason,'server_absent');assert.equal(f.calls.length,0);assert.equal(f.ports.observations.size,0);assert.equal(rows.at(-1).reason,'server_absent');
 f.ports.observeHerdr=async()=>({complete:true,upSince:0,stableSince:0});assert.equal((await f.pass(90000))[0].code,'observing_lock');assert.equal(f.calls.length,0);
});


const c19Absent={complete:false,upSince:null,stableSince:null,code:'herdr_not_found',reason:'server_absent',message:'Herdr is not running. Run pdd setup to start the Herdr service, then inspect pdd workflow status before resuming the saved run.'};
test('C19 keeper boots only explicit absence with saved runtime and waits for fresh settling and both lock checks',async()=>{
 const f=fixture(),runtime={releaseId:'saved',herdr:'/saved/herdr'},boots=[];f.state.runtime=runtime;f.ports.runtime={releaseId:'current',herdr:'/other/herdr'};
 let observation=c19Absent;f.ports.observeHerdr=async()=>observation;
 f.ports.ensureDefaultHerdr=async p=>{assert.equal(p.runtime,runtime);assert.equal(p.observeHerdr,f.ports.observeHerdr);boots.push(p);return {state:'ready'};};
 assert.equal((await f.pass(30000))[0].code,'herdr_unsettled');assert.equal(boots.length,1);assert.equal(f.calls.length,0);
 assert.equal((await f.pass(60000))[0].state,'needs_you');assert.equal(boots.length,1,'same absent episode never repeats startup');
 observation={complete:false};await f.pass(90000);observation=c19Absent;await f.pass(120000);assert.equal(boots.length,1,'unknown cannot reset startup fence');
 observation={complete:true,server:{pid:321,startIdentity:'boot:one'},upSince:150000,stableSince:150000};
 assert.equal((await f.pass(150000))[0].code,'herdr_unsettled');assert.equal((await f.pass(180000))[0].code,'observing_lock');assert.equal(f.calls.length,0);
 assert.equal((await f.pass(210000))[0].state,'started');assert.equal(f.calls.length,1);
 observation=c19Absent;await f.pass(240000);assert.equal(boots.length,2,'a new absence after proved service may request one startup');
});

test('C19 keeper absence startup remains fenced across errors concurrent passes and different run entries',async()=>{
 const f=fixture();let boots=0,release;const pending=new Promise(r=>{release=r;});f.ports.observeHerdr=async()=>c19Absent;f.ports.ensureDefaultHerdr=async()=>{boots++;await pending;throw Error('lost manager reply');};
 const first=f.pass(30000);await new Promise(r=>setImmediate(r));const second=f.pass(30000);release();await Promise.all([first,second]);assert.equal(boots,1);assert.equal(f.calls.length,0);
 const other='123e4567-e89b-42d3-a456-426614174000';f.entries.push({...f.entries[0],runId:other,runDir:'/saved/'+other});f.ports.readWorkflowJournal=async({runDir})=>({state:{...f.state,runId:runDir.endsWith(other)?other:runId},seq:1});
 await f.pass(60000);assert.equal(boots,1);assert.equal(f.calls.length,0);
});

test('C19 keeper never starts on unknown proof missing executable invalid runtime or human wait',async()=>{
 for(const mode of ['unknown','missing-executable','invalid-runtime','human-wait']){
  const f=fixture();let boots=0;f.ports.ensureDefaultHerdr=async()=>{boots++;return {state:'ready'};};
  f.ports.observeHerdr=async()=>mode==='unknown'?{complete:false}:mode==='missing-executable'?{complete:false,code:'herdr_not_found',message:'Herdr not found at /saved/herdr'}:c19Absent;
  if(mode==='invalid-runtime')f.ports.checkWorkflowRuntime=async()=>({ok:false,code:'runtime_missing'});
  if(mode==='human-wait')f.state.controlState='waiting_person';
  await f.pass(30000);await f.pass(60000);assert.equal(boots,0,mode);assert.equal(f.calls.length,0,mode);
 }
});

test('C19 keeper factory fills startup without invoking it and preserves explicit startup callback',async()=>{
 const {createWorkflowKeeperPorts}=await import('../../src/workflow-keeper.mjs');const f=fixture();let invoked=0;const callback=async()=>{invoked++;return {state:'ready'};};
 const supplied=await createWorkflowKeeperPorts({...f.ports,ensureDefaultHerdr:callback});assert.equal(supplied.ensureDefaultHerdr,callback);assert.equal(invoked,0);
 const defaults=await createWorkflowKeeperPorts(f.ports);assert.equal(typeof defaults.ensureDefaultHerdr,'function');assert.equal(invoked,0);
});

test('C19 real boot and service composition starts the exact installed unit once without admitting a controller',async t=>{
 const {createWorkflowKeeperPorts}=await import('../../src/workflow-keeper.mjs');
 const {herdrServiceFiles}=await import('../../src/workflow-herdr-service.mjs');
 const home=await folder(t),f=fixture(),runtime={releaseId:'saved',herdr:process.execPath};
 const [definition]=herdrServiceFiles({home,herdr:process.execPath,platform:'linux'});
 await fs.mkdir(join(home,'.config/systemd/user'),{recursive:true,mode:0o700});await fs.writeFile(definition.path,definition.text,{mode:0o600});
 f.state.runtime=runtime;const commands=[];let ready=false;
 const ports=await createWorkflowKeeperPorts({...f.ports,home,platform:'linux',runtime:{releaseId:'new',herdr:'/wrong/herdr'},env:{PATH:''},observeHerdr:async()=>c19Absent,
  execFile:async(file,args,options)=>{commands.push({file,args});assert.equal(options.shell,false);assert.ok(options.timeout>0&&options.timeout<=5000);
   if(file===process.execPath){assert.deepEqual(args,['--session','default','workspace','list']);return ready?{stdout:JSON.stringify({result:{workspaces:[]}}),code:0}:{stdout:'',code:1};}
   assert.equal(file,'systemctl');assert.deepEqual(args,['--user','start','pdd-herdr-default.service']);ready=true;return {stdout:'',code:0};}});
 const [row]=await reconcileWorkflowControllers({entries:f.entries,now:30000},ports);
 assert.equal(row.code,'herdr_unsettled');assert.equal(f.calls.length,0);assert.deepEqual(commands.map(x=>x.file),[process.execPath,'systemctl',process.execPath]);
 await reconcileWorkflowControllers({entries:f.entries,now:60000},ports);assert.equal(commands.length,3,'continued absence cannot replay manager startup');assert.equal(f.calls.length,0);
});
