import test from 'node:test';
import assert from 'node:assert/strict';
import {readProcessStartIdentity,createWorkflowHerdrPorts} from '../../src/workflow-herdr-client.mjs';
const boot='123e4567-e89b-42d3-a456-426614174000';
const stat=(pid,tick='987',name='synthetic (name)')=>`${pid} (${name}) S ${Array(18).fill('0').join(' ')} ${tick} 0 0\n`;
const os=(overrides={})=>({readFile:async path=>path.endsWith('boot_id')?boot+'\n':stat(Number(path.split('/')[2])),realpath:async path=>path.startsWith('/proc/')?'/physical/node':path==='/runtime/node'?'/physical/node':path,...overrides});
const processInfo=(overrides={})=>({pane_id:'w1:p7',shell_pid:50,foreground_processes:[{pid:123,name:'node',cwd:'/synthetic',argv:['/runtime/node','/runtime/pdd.mjs','workflow','drive','synthetic-run']}],...overrides});
const encoded=result=>({stdout:JSON.stringify({result}),code:0});
function fixture(extra={}){
 const calls=[];let info=processInfo(),panes=[{pane_id:'w1:p7'}],serverPid=321,serverStart='987',serverSocket='/synthetic/herdr.sock',serverRunning=true;
 const serverFs=os({readFile:async path=>path==='/proc/net/unix'?`x: 2 0 00010000 0001 01 77 ${serverSocket}\n`:path.endsWith('boot_id')?boot:stat(Number(path.split('/')[2]),serverStart),readdir:async path=>path==='/proc'?[String(serverPid)]:['4'],readlink:async()=> 'socket:[77]'});
 const ports={herdrExecutable:process.execPath,home:'/synthetic/home',cwd:'/synthetic/work',platform:'linux',env:{PATH:'/synthetic/bin'},fs:serverFs,execFile:async(file,args,options)=>{
  calls.push({file,args,options});
  assert.equal(file,process.execPath);assert.deepEqual(args.slice(0,2),['--session','default']);assert.equal(options.shell,false);assert.equal(options.env,ports.env);
  const cmd=args.slice(2);
  if(cmd[0]==='status')return {stdout:JSON.stringify({server:{running:serverRunning,status:serverRunning?'running':'stopped',session:null,socket:serverSocket}}),code:0};
  if(cmd[0]==='pane'&&cmd[1]==='list')return encoded({type:'pane_list',panes});
  if(cmd[0]==='pane'&&cmd[1]==='process-info')return encoded({type:'pane_process_info',process_info:info});
  if(cmd[0]==='workspace'&&cmd[1]==='list')return encoded({type:'workspace_list',workspaces:[{workspace_id:'w1',active_tab_id:'w1:t3',pane_count:1}]});
  if(cmd[0]==='workspace'&&cmd[1]==='create')return encoded({workspace:{workspace_id:'w2'},tab:{tab_id:'w2:t4'},root_pane:{pane_id:'w2:p8',terminal_id:'term_abc',tab_id:'w2:t4'}});
  if(cmd[0]==='tab'&&cmd[1]==='create')return encoded({tab:{tab_id:'w1:t9'},root_pane:{pane_id:'w1:p12',terminal_id:'term_abc',tab_id:'w1:t9'}});
  if(cmd[0]==='pane'&&cmd[1]==='run')return encoded({type:'ok'});
  assert.fail('unexpected transport command');
 },...extra};
 return {ports,calls,setInfo:x=>{info=x;},setPanes:x=>{panes=x;},setServer:({pid=serverPid,start=serverStart,socket=serverSocket,running=serverRunning}={})=>{serverPid=pid;serverStart=start;serverSocket=socket;serverRunning=running;}};
}

test('Linux shared identity binds boot ID plus field22 after parenthesized process name',async()=>{
 assert.equal(await readProcessStartIdentity({pid:123},{platform:'linux',fs:os()}),`linux:${boot}:987`);
 assert.equal(await readProcessStartIdentity({pid:0},{platform:'linux',fs:{readFile:()=>assert.fail()}}),null);
 const live=await readProcessStartIdentity({pid:process.pid});
 if(process.platform==='linux')assert.match(live,/^linux:[a-f0-9-]{36}:\d+$/);
});
test('identity refuses PID mismatch, missing boot, changed ticks, changed boot and denied reads',async()=>{
 const bad=[os({readFile:async p=>p.endsWith('boot_id')?'bad':stat(123)}),os({readFile:async p=>p.endsWith('boot_id')?boot:stat(124)}),os({readFile:async()=>{throw Error('private');}})];
 let n=0;bad.push(os({readFile:async p=>p.endsWith('boot_id')?boot:stat(123,String(++n))}));
 let b=0;bad.push(os({readFile:async p=>p.endsWith('boot_id')?(++b===1?boot:'223e4567-e89b-42d3-a456-426614174000'):stat(123)}));
 for(const fs of bad)assert.equal(await readProcessStartIdentity({pid:123},{platform:'linux',fs}),null);
});
test('macOS uses bounded C-locale lstart and refuses changed or unsupported identities',async()=>{
 const calls=[],time='Mon Oct 26 04:00:00 2026';
 const execFile=async(file,args,options)=>{calls.push({file,args,options});return {stdout:time+'\n'};};
 assert.equal(await readProcessStartIdentity({pid:123},{platform:'darwin',execFile}),`darwin:${time}`);
 assert.equal(calls.length,2);assert.equal(calls[0].file,'ps');assert.deepEqual(calls[0].args,['-o','lstart=','-p','123']);assert.equal(calls[0].options.env.LC_ALL,'C');assert.equal(calls[0].options.shell,false);
 let n=0;assert.equal(await readProcessStartIdentity({pid:123},{platform:'darwin',execFile:async()=>({stdout:++n===1?time:'Tue Oct 27 04:00:00 2026'})}),null);
 assert.equal(await readProcessStartIdentity({pid:123},{platform:'win32',execFile:()=>assert.fail()}),null);
});
test('factory and supplied bindings have no import-time or factory-time effects and preserve references',async()=>{
 const herdr={},processStartIdentity=()=>{},observeHerdr=()=>{},unknown={same:true};
 const value=await createWorkflowHerdrPorts({herdr,processStartIdentity,observeHerdr,unknown,execFile:()=>assert.fail(),fs:{readFile:()=>assert.fail()}});
 assert.equal(value.herdr,herdr);assert.equal(value.processStartIdentity,processStartIdentity);assert.equal(value.observeHerdr,observeHerdr);
});
test('real-shaped workspace and root_pane creation bindings preserve operands and do not guess missing cwd',async()=>{
 const f=fixture(),{herdr}=await createWorkflowHerdrPorts(f.ports);
 assert.deepEqual(await herdr.listWorkspaces({session:'default'}),[{workspaceId:'w1',cwd:null}]);
 assert.equal((await herdr.createWorkspace({session:'default',cwd:'/repo with space',focus:false})).workspaceId,'w2');
 assert.deepEqual(await herdr.createTab({session:'default',workspaceId:'w1',cwd:'/repo with space',label:'run #17 small-change',focus:false}),{tabId:'w1:t9',paneId:'w1:p12',terminalId:'term_abc'});
 await herdr.paneRun({session:'default',paneId:'w1:p7',command:"PDD_TRACE='herdr,git' '/node' '/pdd' workflow drive saved"});
 assert.deepEqual(f.calls[1].args.slice(2),['workspace','create','--cwd','/repo with space','--no-focus']);
 assert.deepEqual(f.calls[3].args.slice(2),['pane','run','w1:p7',"PDD_TRACE='herdr,git' '/node' '/pdd' workflow drive saved"]);
 for(const call of f.calls){assert.equal(call.options.cwd,'/synthetic/work');assert.equal(call.options.timeout,5000);assert.equal(call.options.maxBuffer,1024*1024);}
});
test('normalized process proof uses actual foreground PID, full argv, OS executable and shared identity',async()=>{
 const f=fixture(),{herdr,processStartIdentity}=await createWorkflowHerdrPorts(f.ports);
 const proof=await herdr.processInfo({session:'default',paneId:'w1:p7'});
 assert.deepEqual(proof,{pid:123,startIdentity:`linux:${boot}:987`,paneId:'w1:p7',executable:'/runtime/node',argv:processInfo().foreground_processes[0].argv});
 assert.equal(await processStartIdentity({pid:123}),proof.startIdentity);assert.equal(f.calls.length,2);
});
test('process proof refuses ambiguous, missing, mismatched pane, executable and reused PID evidence',async()=>{
 const rows=[processInfo({foreground_processes:[]}),processInfo({foreground_processes:[...processInfo().foreground_processes,...processInfo().foreground_processes]}),processInfo({pane_id:'w1:p8'})];
 for(const row of rows){const f=fixture();f.setInfo(row);const {herdr}=await createWorkflowHerdrPorts(f.ports);await assert.rejects(herdr.processInfo({session:'default',paneId:'w1:p7'}));assert.ok(f.calls.length<=1);}
 const f=fixture({fs:os({realpath:async p=>p.startsWith('/proc/')?'/different':'/physical/node'})}),{herdr}=await createWorkflowHerdrPorts(f.ports);
 await assert.rejects(herdr.processInfo({session:'default',paneId:'w1:p7'}),/process_unproved/);
 let n=0;const x=fixture({processStartIdentity:async()=>String(++n)}),h=await createWorkflowHerdrPorts(x.ports);
 await assert.rejects(h.herdr.processInfo({session:'default',paneId:'w1:p7'}),/process_unproved/);
});
test('capability checks read only existing panes and fresh OS identity; empty or unavailable is false',async()=>{
 const f=fixture(),{herdr}=await createWorkflowHerdrPorts(f.ports);
 assert.equal(await herdr.supportsProcessIdentity(),true);
 assert.ok(f.calls.every(x=>x.args[2]==='pane'&&['list','process-info'].includes(x.args[3])));
 f.setPanes([]);assert.equal(await herdr.supportsProcessIdentity(),false);
 const h=await createWorkflowHerdrPorts(fixture({processStartIdentity:async()=>null}).ports);assert.equal(await h.herdr.supportsProcessIdentity(),false);
});
test('opaque alphanumeric pane and creation handles remain exact instead of decimal-only',async()=>{
 const calls=[],argv=['/runtime/node','/runtime/pdd.mjs','workflow','drive','synthetic-run'];
 const {herdr}=await createWorkflowHerdrPorts({platform:'linux',fs:os(),execFile:async(file,args)=>{
  calls.push(args);
  if(args[3]==='list')return encoded({panes:[{pane_id:'wA:pZ'}]});
  if(args[3]==='process-info'){assert.equal(args.at(-1),'wA:pZ');return encoded({process_info:{pane_id:'wA:pZ',shell_pid:123,foreground_processes:[{pid:123,argv}]}});}
  if(args[2]==='workspace')return encoded({workspace:{workspace_id:'wB'}});
  if(args[2]==='tab')return encoded({tab:{tab_id:'wA:tY'},root_pane:{pane_id:'wA:pZ',tab_id:'wA:tY',terminal_id:'term_abc'}});
  assert.fail('unexpected command');
 }});
 assert.equal(await herdr.supportsProcessIdentity(),true);
 assert.equal((await herdr.processInfo({session:'default',paneId:'wA:pZ'})).paneId,'wA:pZ');
 assert.equal((await herdr.createWorkspace({session:'default',cwd:'/synthetic'})).workspaceId,'wB');
 assert.equal((await herdr.createTab({session:'default',workspaceId:'wA',cwd:'/synthetic',label:'synthetic'})).tabId,'wA:tY');
 assert.ok(calls.some(x=>x.includes('wA:pZ')));
});
test('historical shell reply shape has no identity field; OS evidence is required for capability',async()=>{
 const f=fixture();f.setInfo(processInfo({foreground_process_group_id:50,shell_pid:50,foreground_processes:[{argv:['/bin/bash'],cmdline:'/bin/bash',cwd:'/synthetic/repo',name:'bash',pid:50}]}));
 const {herdr}=await createWorkflowHerdrPorts(f.ports);assert.equal(await herdr.supportsProcessIdentity(),true);
 const missing=await createWorkflowHerdrPorts({...f.ports,fs:os({readFile:async()=>{throw Error('missing OS identity');}})});assert.equal(await missing.herdr.supportsProcessIdentity(),false);
 assert.ok(f.calls.every(x=>['list','process-info'].includes(x.args[3])));
});
test('keeper observations start at actual reads, retain continuity and reset failure or inventory change',async()=>{
 // Retain the historical test identity; C18 replaces the inventory-reset rule
 // with server continuity. Failure and backward-time controls remain strict.
 let time=1000;const f=fixture({herdrObservationNow:()=>time}),{observeHerdr}=await createWorkflowHerdrPorts(f.ports);
 const server={pid:321,startIdentity:`linux:${boot}:987`};
 assert.deepEqual(await observeHerdr(),{complete:true,upSince:1000,stableSince:1000,server});
 time=6000;assert.deepEqual(await observeHerdr(),{complete:true,upSince:1000,stableSince:1000,server});
 f.setPanes([]);time=7000;assert.deepEqual(await observeHerdr(),{complete:true,upSince:1000,stableSince:1000,server});
 f.setServer({running:false});assert.deepEqual(await observeHerdr(),{complete:false,upSince:null,stableSince:null});
 f.setServer({running:true});time=8000;assert.deepEqual(await observeHerdr(),{complete:true,upSince:8000,stableSince:8000,server});
 time=7000;assert.deepEqual(await observeHerdr(),{complete:true,upSince:7000,stableSince:7000,server});
});
test('failed delivery, nonzero JSON and malformed replies never retry a mutation or leak raw details',async()=>{
 for(const mode of ['rejected','nonzero','invalid']){
  let calls=0;const {herdr}=await createWorkflowHerdrPorts({execFile:async()=>{calls++;if(mode==='rejected')throw Object.assign(Error('synthetic-secret'),{code:'ECONNREFUSED'});if(mode==='nonzero')return {code:1,stdout:'',stderr:'synthetic-secret'};return {stdout:'synthetic-secret'};}});
  await assert.rejects(herdr.paneRun({session:'default',paneId:'w1:p7',command:'only once'}),e=>e.message==='herdr_command_uncertain'&&!e.message.includes('synthetic-secret'));assert.equal(calls,1);
 }
 const f=fixture(),{herdr}=await createWorkflowHerdrPorts(f.ports);
 await assert.rejects(herdr.paneRun({session:'other',paneId:'w1:p7',command:'x'}));
 await assert.rejects(herdr.paneRun({session:'default',paneId:'not-an-id',command:'x'}));assert.equal(f.calls.length,0);
});

test('targeted capability proves a new pane with no inventory and refuses wrong or unstable identity',async()=>{
 const f=fixture(),{herdr}=await createWorkflowHerdrPorts(f.ports);f.setPanes([]);
 assert.equal(await herdr.supportsProcessIdentity({session:'default',paneId:'w1:p7'}),true);
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(x=>x.args[3]==='process-info'));
 for(const request of [{session:'other',paneId:'w1:p7'},{session:'default',paneId:'invalid'},{session:'default',paneId:'w1:p8'}])assert.equal(await herdr.supportsProcessIdentity(request),false);
 for(const processStartIdentity of [async()=>null,(()=>{let n=0;return async()=>String(++n);})()]){
  const g=fixture({processStartIdentity}),h=await createWorkflowHerdrPorts(g.ports);g.setPanes([]);
  assert.equal(await h.herdr.supportsProcessIdentity({session:'default',paneId:'w1:p7'}),false);
 }
});

test('issue20 C1 Herdr 0.9.1 empty successful pane run acknowledges delivery once without process proof',async()=>{
 for(const status of [{code:0},{exitCode:0},{}]){
  const calls=[],command="'/runtime/node' '/runtime/pdd.mjs' workflow drive synthetic-run";
  const {herdr}=await createWorkflowHerdrPorts({herdrExecutable:process.execPath,env:{PDD_TRACE:''},execFile:async(file,args,options)=>{
   calls.push({file,args,options});return {...status,stdout:'',stderr:''};
  },processStartIdentity:()=>assert.fail('delivery is not process proof')});
  assert.deepEqual(await herdr.paneRun({session:'default',paneId:'w1:p7',command}),{});
  assert.equal(calls.length,1);assert.equal(calls[0].file,process.execPath);
  assert.deepEqual(calls[0].args,['--session','default','pane','run','w1:p7',command]);assert.equal(calls[0].options.shell,false);
 }
});

test('issue20 C1 empty success never substitutes for read or creation reply bindings',async()=>{
 for(const request of [h=>h.listWorkspaces({session:'default'}),h=>h.createWorkspace({session:'default',cwd:'/synthetic'}),h=>h.createTab({session:'default',workspaceId:'w1',cwd:'/synthetic',label:'synthetic'}),h=>h.processInfo({session:'default',paneId:'w1:p7'})]){
  let calls=0;const {herdr}=await createWorkflowHerdrPorts({herdrExecutable:process.execPath,env:{PDD_TRACE:''},execFile:async()=>{calls++;return {code:0,stdout:''};}});
  await assert.rejects(request(herdr));assert.equal(calls,1);
 }
});

test('issue20 C1 only exactly empty successful pane run bypasses JSON validation without retry',async()=>{
 const responses=[{code:1,stdout:''},{exitCode:1,stdout:''},{code:0,stdout:'\n'},{code:0,stdout:'synthetic-private-reply'},{code:0,stdout:'{"error":{"message":"synthetic-private-reply"}}'},{code:0},{code:0,stdout:null}];
 for(const response of responses){
  let calls=0;const {herdr}=await createWorkflowHerdrPorts({herdrExecutable:process.execPath,env:{PDD_TRACE:''},execFile:async()=>{calls++;return response;}});
  await assert.rejects(herdr.paneRun({session:'default',paneId:'w1:p7',command:'only once'}),e=>e.code==='herdr_command_uncertain'&&e.message==='herdr_command_uncertain');assert.equal(calls,1);
 }
});

// Synthetic counterpart of issue21: a drive group leader and its child are
// returned together. Operational paths, process IDs and UUIDs are not fixtures.
const issue21Drive=['/runtime/node','/runtime/pdd.mjs','workflow','drive','123e4567-e89b-42d3-a456-426614174000','--launch-id','223e4567-e89b-42d3-a456-426614174000'];
const issue21Group=(overrides={})=>processInfo({foreground_process_group_id:123,foreground_processes:[{pid:123,name:'node',argv:[...issue21Drive]},{pid:456}],...overrides});

test('issue21 C10 selects the foreground group leader with child members, preserving full drive binding',async()=>{
 for(const order of ['leader-first','child-first','child-exits']){
  const seen=[];const f=fixture({processStartIdentity:async({pid})=>{seen.push(pid);return `linux:${boot}:987`;}});
  const original=f.ports.execFile;let reads=0;
  f.ports.execFile=async(...args)=>{
   const rows=issue21Group();if(order==='child-first')rows.foreground_processes.reverse();
   if(order==='child-exits'&&reads>0)rows.foreground_processes.pop();
   f.setInfo(rows);reads++;return original(...args);
  };
  const {herdr}=await createWorkflowHerdrPorts(f.ports),proof=await herdr.processInfo({session:'default',paneId:'w1:p7'});
  assert.deepEqual(proof,{pid:123,startIdentity:`linux:${boot}:987`,paneId:'w1:p7',executable:'/runtime/node',argv:issue21Drive});
  assert.deepEqual(seen,[123,123]);assert.equal(f.calls.length,2);
  assert.ok(f.calls.every(c=>c.args[3]==='process-info'));
 }
});

test('issue21 C10 never substitutes a child or process name for an unusable or ambiguous group leader',async()=>{
 const leader={pid:123,name:'node',argv:issue21Drive},child={pid:456,name:'node',argv:issue21Drive};
 const invalid=[
  issue21Group({foreground_process_group_id:999}),
  issue21Group({foreground_processes:[child]}),
  issue21Group({foreground_processes:[leader,{...leader},child]}),
  issue21Group({foreground_processes:[{pid:123},child]}),
  issue21Group({foreground_processes:[{...leader,argv:['relative-node']},child]}),
  issue21Group({foreground_processes:[{...leader,argv:['/runtime/node','bad\0arg']},child]}),
  ...[null,0,-1,1.5,'123'].map(foreground_process_group_id=>issue21Group({foreground_process_group_id,foreground_processes:[leader]})),
  processInfo({foreground_processes:[leader,child]})
 ];
 for(const row of invalid){
  const f=fixture({processStartIdentity:()=>assert.fail('invalid leader cannot reach OS proof')});f.setInfo(row);
  const {herdr}=await createWorkflowHerdrPorts(f.ports);
  await assert.rejects(herdr.processInfo({session:'default',paneId:'w1:p7'}),{code:'process_unproved'});assert.equal(f.calls.length,1);
 }
});

test('issue21 C10 repeated leader selection refuses changed group, PID, argv, OS identity and executable',async()=>{
 for(const mode of ['group','missing-leader','duplicate-leader','argv','launch-id','start','executable','pane']){
  let identities=0;const f=fixture({processStartIdentity:async()=>mode==='start'?String(++identities):'boot:start'}),original=f.ports.execFile;
  if(mode==='executable')f.ports.fs=os({realpath:async p=>p.startsWith('/proc/')?'/other/node':'/physical/node'});
  let reads=0;f.ports.execFile=async(...args)=>{
   const row=issue21Group();
   if(reads++){
    if(mode==='group'){row.foreground_process_group_id=456;row.foreground_processes[1].argv=issue21Drive;}
    if(mode==='missing-leader')row.foreground_processes.shift();
    if(mode==='duplicate-leader')row.foreground_processes.push({...row.foreground_processes[0]});
    if(mode==='argv')row.foreground_processes[0].argv.push('--other');
    if(mode==='launch-id')row.foreground_processes[0].argv[6]='323e4567-e89b-42d3-a456-426614174000';
    if(mode==='pane')row.pane_id='w1:p8';
   }
   f.setInfo(row);return original(...args);
  };
  const {herdr}=await createWorkflowHerdrPorts(f.ports);
  await assert.rejects(herdr.processInfo({session:'default',paneId:'w1:p7'}),{code:'process_unproved'});
  assert.equal(f.calls.length,mode==='executable'?1:2);assert.ok(f.calls.every(c=>c.args[3]==='process-info'));
 }
});


test('C18 same server stays stable while panes and foreground agents change on every observation',async()=>{
 let time=0;const f=fixture({herdrObservationNow:()=>time}),{observeHerdr}=await createWorkflowHerdrPorts(f.ports);
 for(time of [0,1000,5000,30000,60000,90000]){
  f.setPanes([{pane_id:`w2:p${time+1}`}]);f.setInfo(processInfo({foreground_processes:[{pid:700+time,argv:['/agent'] }]}));
  assert.deepEqual(await observeHerdr(),{complete:true,upSince:0,stableSince:0,server:{pid:321,startIdentity:`linux:${boot}:987`}});
 }
 assert.ok(f.calls.every(c=>c.args.slice(2).join(' ')==='status --json'),'server observation never depends on pane inventory or contents');
});

test('C18 server PID reuse, restart, endpoint change and long observation gaps start a new stability interval',async()=>{
 let time=0;const f=fixture({herdrObservationNow:()=>time}),{observeHerdr}=await createWorkflowHerdrPorts(f.ports);
 await observeHerdr();time=30000;f.setServer({pid:322});assert.equal((await observeHerdr()).stableSince,30000);
 time=60000;f.setServer({start:'988'});assert.equal((await observeHerdr()).stableSince,60000);
 time=90000;f.setServer({socket:'/synthetic/two  spaces/herdr.sock'});assert.equal((await observeHerdr()).stableSince,90000);
 time=150001;assert.equal((await observeHerdr()).stableSince,150001);
});

test('C18 ambiguous socket owners, missing identity and changes within a server sample stay unproved',async()=>{
 for(const mode of ['owners','inode','identity','race','reply']){
  let n=0;const f=fixture();
  if(mode==='owners')f.ports.fs.readdir=async p=>p==='/proc'?['321','322']:['4'];
  if(mode==='inode')f.ports.fs.readlink=async()=> 'socket:[78]';
  if(mode==='identity')f.ports.processStartIdentity=async()=>null;
  if(mode==='race')f.ports.processStartIdentity=async()=>String(++n);
  if(mode==='reply')f.ports.execFile=async()=>({stdout:JSON.stringify({server:{running:true,status:'running',session:'other',socket:'/synthetic/herdr.sock'}})});
  const {observeHerdr}=await createWorkflowHerdrPorts(f.ports);
  assert.deepEqual(await observeHerdr(),{complete:false,upSince:null,stableSince:null},mode);
 }
});

test('C18 macOS socket owner uses bounded read-only OS identity; ambiguous ownership refuses',async()=>{
 let time=0,owners='p321\n';const calls=[];
 const {observeHerdr}=await createWorkflowHerdrPorts({herdrExecutable:process.execPath,platform:'darwin',home:'/synthetic',env:{PATH:''},herdrObservationNow:()=>time,
  execFile:async(file,args,options)=>{calls.push({file,args,options});if(file===process.execPath)return {stdout:JSON.stringify({server:{running:true,status:'running',session:null,socket:'/synthetic/herdr.sock'}})};
   if(file==='/usr/sbin/lsof'){assert.deepEqual(args,['-nP','-a','-U','-Fp','--','/synthetic/herdr.sock']);assert.equal(options.timeout,2000);assert.equal(options.shell,false);return {stdout:owners};}
   assert.equal(file,'ps');return {stdout:'Mon Oct 26 04:00:00 2026\n'};}});
 assert.equal((await observeHerdr()).stableSince,0);time=30000;assert.equal((await observeHerdr()).stableSince,0);
 owners='p321\np322\n';assert.equal((await observeHerdr()).complete,false);
 assert.ok(calls.every(c=>c.options.shell===false));
});

test('C18 real Linux listening socket binds its actual PID and OS start identity', {timeout:10000}, async t=>{
 if(process.platform!=='linux'){t.skip('Linux procfs integration');return;}
 const {createServer}=await import('node:net'),fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const root=await fs.mkdtemp(join(tmpdir(),'c18-socket-')),socket=join(root,'server  endpoint.sock');
 const listener=createServer();
 t.after(async()=>{await new Promise(resolve=>listener.close(resolve));await fs.rm(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(socket,resolve);});
 let time=0;
 const {observeHerdr}=await createWorkflowHerdrPorts({herdrExecutable:process.execPath,env:{PATH:'',PDD_TRACE:''},herdrObservationNow:()=>time,
  execFile:async(file,args)=>{assert.equal(file,process.execPath);assert.deepEqual(args,['--session','default','status','--json']);return {stdout:JSON.stringify({server:{running:true,status:'running',session:null,socket}})};}});
 const first=await observeHerdr();assert.equal(first.complete,true);assert.equal(first.server.pid,process.pid);
 assert.equal(first.server.startIdentity,await readProcessStartIdentity({pid:process.pid}));
 time=30000;assert.deepEqual(await observeHerdr(),first,'same OS server retains both initial stability times');
});

for(const duplicate of [false,true])test(`C18 bounded procfs scan completes the inventory before ownership proof, duplicate=${duplicate}`,async()=>{
 const f=fixture(),names=Array.from({length:48},(_,i)=>String(100+i)),scans=[];
 let active=0,peak=0;
 const read=async action=>{active++;peak=Math.max(peak,active);try{await new Promise(resolve=>setImmediate(resolve));return action();}finally{active--;}};
 f.ports.fs.readdir=async path=>{
  if(path==='/proc'){scans.push(new Set());return names;}
  return read(()=>{scans.at(-1).add(path.split('/')[2]);return ['4','5'];});
 };
 f.ports.fs.readlink=async path=>read(()=>{
  const [, ,pid,,fd]=path.split('/');
  return fd==='5'&&(pid==='100'||duplicate&&pid==='147')?'socket:[77]':'socket:[78]';
 });
 const {observeHerdr}=await createWorkflowHerdrPorts(f.ports),seen=await observeHerdr();
 assert.ok(peak>1,'independent procfs reads overlap instead of serializing the host inventory');
 assert.ok(peak<=16,'the scan does not enqueue one read for every process at once');assert.equal(active,0);
 assert.equal(scans.length,duplicate?1:2);for(const scanned of scans)assert.deepEqual([...scanned].sort(),names);
 if(duplicate)assert.deepEqual(seen,{complete:false,upSince:null,stableSince:null});
 else{assert.equal(seen.complete,true);assert.deepEqual(seen.server,{pid:100,startIdentity:`linux:${boot}:987`});}
});


test('C20 explicit absent server reports the setup fix while contradictory and unknown replies remain unproved',async()=>{
 for(const mode of ['absent','wrong-session','contradictory','malformed','transport']){
  const f=fixture();f.ports.fs.readdir=()=>assert.fail('no ownership scan without a running server');
  f.ports.execFile=async()=>{if(mode==='transport')throw Error('no transport proof');return {code:0,stdout:JSON.stringify({server:mode==='malformed'?{}:{running:false,status:mode==='contradictory'?'running':'not_running',session:mode==='wrong-session'?'other':'default'}})};};
  const {observeHerdr}=await createWorkflowHerdrPorts(f.ports),result=await observeHerdr();assert.equal(result.complete,false);assert.equal(result.upSince,null);assert.equal(result.stableSince,null);
  if(mode==='absent'){assert.equal(result.code,'herdr_not_found');assert.equal(result.reason,'server_absent');assert.match(result.message,/^Herdr is not running.*pdd setup/);}else assert.equal(result.code,undefined,mode);
 }
});
