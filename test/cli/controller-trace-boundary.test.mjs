import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runPdd} from '../../src/pdd-cli.mjs';
import {readHerdrTrace} from '../../src/herdr-trace.mjs';
const id='7aa58de0-c656-4a8c-9d03-7227dbe7a759';
const capture=()=>({text:'',write(x){this.text+=x;}});
test('trace exposes actual strict controller refusal without inventing ports, changing runtime or retrying',async t=>{
  const home=mkdtempSync(join(tmpdir(),'pdd-controller-boundary-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const raw={node:'/synthetic/node',bin:'/synthetic/bin',unknown:{kept:true}},frozen={...raw,packageRoot:'/synthetic/frozen'},stdout=capture(),stderr=capture();let resumes=0;
  assert.equal(await runPdd(['workflow','resume',id],{home,stdout,stderr,workflowHerdrBoot:{ensureDefaultHerdr:async()=>({state:'ready',code:null})},ports:{herdr:{supportsProcessIdentity:async()=>false},env:{PDD_TRACE:'herdr'},runtime:raw},workflowRunner:{resumeWorkflow:async(input,ports)=>{
    resumes++;assert.equal(ports.runtime,raw);assert.equal(input.runId,id);return {state:'prepared',runId:id,root:'/synthetic/repo',runDir:'/synthetic/run',workflow:'small-change',issueNumber:17,runtime:frozen};
  }}}),1);
  assert.equal(resumes,1);assert.equal(stdout.text,'');assert.equal(stderr.text,'Workflow controller not started: refused (unsupported). Inspect the saved run before retrying.\n');
  const rows=readHerdrTrace({home});assert.deepEqual(rows.map(r=>[r.operation,r.phase]),[['workflow.resume','request'],['workflow.resume','reply'],['controller.start','request'],['controller.start','reply']]);
  assert.equal(rows.at(-1).payload.state,'refused');assert.equal(rows.at(-1).payload.code,'unsupported');assert.equal(rows[1].payload.runtime.packageRootPresent,true);assert.equal(raw.packageRoot,undefined);assert.deepEqual(raw.unknown,{kept:true});
});

for(const action of ['run','resume']) test(`controller ${action} refusal reports state, code and supplied missing ports without a retry`,async()=>{
  const stdout=capture(),stderr=capture();let preparations=0,starts=0;
  const prepared={state:'prepared',runId:id};
  const prepare=async()=>{preparations++;return prepared;};
  const result={state:'refused',code:'unsupported',missingPorts:['validateRun','herdr.processInfo','bad\nname',null],message:'synthetic-private-message',private:{secret:'synthetic-secret'}};
  const argv=action==='run'?['workflow','run','small-change','17']:['workflow','resume',id];
  assert.equal(await runPdd(argv,{stdout,stderr,
    workflowModels:{resolveWorkflowModel:async()=>({state:'selected',selection:{agent:'codex',model:'synthetic'}})},
    workflowRunner:{prepareWorkflow:prepare,resumeWorkflow:prepare},
    workflowController:{startWorkflowController:async spec=>{starts++;assert.equal(spec.runId,id);return result;}}
  }),1);
  assert.equal(preparations,1);assert.equal(starts,1);assert.equal(stdout.text,'');
  assert.equal(stderr.text,'Workflow controller not started: refused (unsupported). Missing ports: validateRun, herdr.processInfo. Inspect the saved run before retrying.\n');
  assert.doesNotMatch(stderr.text,/synthetic-private|synthetic-secret|bad/);
  assert.deepEqual(result.missingPorts,['validateRun','herdr.processInfo','bad\nname',null]);
});

test('controller diagnostic preserves unfamiliar codes and labels absent values without dumping arbitrary data',async()=>{
  const cases=[
    [{state:'uncertain',code:'future_guard_42'},'uncertain (future_guard_42)'],
    [{state:'refused',code:'new\ncode\u001b'},'refused (newcode)'],
    [{state:'refused',code:null},'refused (null)'],
    [{state:'refused',code:''},'refused (unknown)'],
    [{},'unknown (unknown)'],
    [null,'unknown (unknown)']
  ];
  for(const [result,expected] of cases){
    const stdout=capture(),stderr=capture();let starts=0;
    assert.equal(await runPdd(['workflow','resume',id],{stdout,stderr,
      workflowRunner:{resumeWorkflow:async()=>({state:'prepared',runId:id})},
      workflowController:{startWorkflowController:async()=>{starts++;return result;}}
    }),1);
    assert.equal(starts,1);assert.equal(stdout.text,'');
    assert.equal(stderr.text,!['refused','failed'].includes(result?.state)?`Workflow controller may be running: ${expected}. Check pdd workflow status ${id}.\n`:`Workflow controller not started: ${expected}. Inspect the saved run before retrying.\n`);
  }
});

test('controller started and thrown failure retain their distinct output and exit contracts',async()=>{
  for(const started of [true,false]){
    const stdout=capture(),stderr=capture();let calls=0;
    const code=await runPdd(['workflow','resume',id],{stdout,stderr,
      workflowRunner:{resumeWorkflow:async()=>({state:'prepared',runId:id})},
      workflowController:{startWorkflowController:async()=>{calls++;if(!started)throw Error('synthetic-secret');return {state:'started',code:null};}}
    });
    assert.equal(calls,1);assert.equal(code,started?0:1);
    assert.equal(stdout.text,started?`Started workflow ${id}.\n`:'');
    assert.equal(stderr.text,started?'':'The local workflow operation could not be confirmed. Inspect saved state before retrying.\n');
  }
});

test('identity refusal prints its code and safe explanation without raw controller message',async()=>{
 const stdout=capture(),stderr=capture();let calls=0;
 assert.equal(await runPdd(['workflow','resume',id],{stdout,stderr,
  workflowRunner:{resumeWorkflow:async()=>({state:'prepared',runId:id})},
  workflowController:{startWorkflowController:async()=>{calls++;return {state:'refused',code:'herdr_identity_unavailable',message:'private raw failure'};}}
 }),1);
 assert.equal(calls,1);assert.equal(stdout.text,'');
 assert.equal(stderr.text,'Workflow controller not started: refused (herdr_identity_unavailable). Herdr process identity is unavailable for the new controller pane. No controller command was sent. Inspect the saved run before retrying.\n');
 assert.doesNotMatch(stderr.text,/private raw failure/);
});
