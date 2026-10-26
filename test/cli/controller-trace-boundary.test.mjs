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
  assert.equal(await runPdd(['workflow','resume',id],{home,stdout,stderr,ports:{env:{PDD_TRACE:'herdr'},runtime:raw},workflowRunner:{resumeWorkflow:async(input,ports)=>{
    resumes++;assert.equal(ports.runtime,raw);assert.equal(input.runId,id);return {state:'prepared',runId:id,root:'/synthetic/repo',runDir:'/synthetic/run',workflow:'small-change',issueNumber:17,runtime:frozen};
  }}}),1);
  assert.equal(resumes,1);assert.equal(stdout.text,'');assert.equal(stderr.text,'Workflow controller launch unconfirmed. Inspect the saved run before retrying.\n');
  const rows=readHerdrTrace({home});assert.deepEqual(rows.map(r=>[r.operation,r.phase]),[['workflow.resume','request'],['workflow.resume','reply'],['controller.start','request'],['controller.start','reply']]);
  assert.equal(rows.at(-1).payload.state,'refused');assert.equal(rows.at(-1).payload.code,'unsupported');assert.equal(rows[1].payload.runtime.packageRootPresent,true);assert.equal(raw.packageRoot,undefined);assert.deepEqual(raw.unknown,{kept:true});
});
