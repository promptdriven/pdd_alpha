import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {resolveHerdrExecutable,recordHerdrRuntime,readHerdrRuntime} from '../../src/workflow-herdr-executable.mjs';
import {createWorkflowHerdrPorts} from '../../src/workflow-herdr-client.mjs';
import {ensureDefaultHerdr} from '../../src/workflow-herdr-boot.mjs';
import {withUpdateLock} from '../../src/update-lock.mjs';
import {readInstallRecord} from '../../src/install-record.mjs';
import {runPdd} from '../../src/pdd-cli.mjs';
const capture=()=>({text:'',write(text){this.text+=text;}});
async function fixture(t){
 const home=await fs.mkdtemp(join(tmpdir(),'pdd-absolute-herdr-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const dir=join(home,'tool with spaces');await fs.mkdir(dir);const executable=join(dir,'herdr');
 await fs.writeFile(executable,`#!${process.execPath}\nprocess.stdout.write(JSON.stringify({result:{workspaces:[{workspace_id:'w7',cwd:'/assigned'}]}}));\n`,{mode:0o700});
 return {home,executable};
}
test('setup binding survives a fresh factory with no Herdr on pane PATH and keeps immutable descriptors',async t=>{
 const {home,executable}=await fixture(t),runtime={v:1,releaseId:'synthetic',versionRoot:'/immutable/release'},original=structuredClone(runtime);
 const bound=await withUpdateLock({home},lease=>recordHerdrRuntime({home,runtime,herdr:executable,lease}));
 assert.equal(bound.herdr,executable);assert.deepEqual(runtime,original);
 const saved=await readHerdrRuntime({home,runtime});assert.deepEqual(saved,bound);
 const {herdr}=await createWorkflowHerdrPorts({home,runtime:saved,env:{PATH:''}});
 assert.deepEqual(await herdr.listWorkspaces({session:'default'}),[{workspaceId:'w7',cwd:'/assigned'}]);
 const readiness=await ensureDefaultHerdr({home,runtime:saved,env:{PATH:''}});
 assert.equal(readiness.state,'ready');assert.equal(readiness.executable,executable);
 assert.equal((await readInstallRecord({home})).value.herdr,executable);
 // The frozen selection wins over later machine setup and an explicit alternative.
 await withUpdateLock({home},lease=>recordHerdrRuntime({home,runtime,herdr:process.execPath,lease}));
 assert.equal(await resolveHerdrExecutable({runtime:saved,herdrExecutable:process.execPath,env:{PATH:''}}),executable);
 assert.equal((await readHerdrRuntime({home,runtime:saved})),saved);
});
test('missing recorded Herdr refuses with its exact path and never invokes PATH replacement or startup',async t=>{
 const {home,executable}=await fixture(t),runtime={herdr:executable};await fs.unlink(executable);
 const ports={home,runtime,herdrExecutable:process.execPath,env:{PATH:'/usr/bin:/bin'},execFile:()=>assert.fail('No transport or startup')};
 await assert.rejects(resolveHerdrExecutable(ports),{code:'herdr_not_found',message:`Herdr not found at ${executable}`});
 const {herdr,observeHerdr}=await createWorkflowHerdrPorts(ports);
 await assert.rejects(herdr.listWorkspaces({session:'default'}),{code:'herdr_not_found',message:`Herdr not found at ${executable}`});
 await assert.rejects(herdr.supportsProcessIdentity({session:'default',paneId:'w1:p1'}),{code:'herdr_not_found',message:`Herdr not found at ${executable}`});
 await assert.rejects(herdr.processInfo({session:'default',paneId:'w1:p1'}),{code:'herdr_not_found'});
 const observation=await observeHerdr();assert.equal(observation.complete,false);assert.equal(observation.code,'herdr_not_found');assert.equal(observation.message,`Herdr not found at ${executable}`);
 const boot=await ensureDefaultHerdr(ports);assert.equal(boot.code,'herdr_not_found');assert.equal(boot.message,`Herdr not found at ${executable}`);
});
test('legacy discovery returns physical absolute executable and malformed explicit bindings cannot become discovery',async t=>{
 const {home,executable}=await fixture(t),bin=join(home,'bin');await fs.mkdir(bin);await fs.symlink(executable,join(bin,'herdr'));
 assert.equal(await resolveHerdrExecutable({env:{PATH:bin}}),executable);
 for(const path of [null,false,'herdr','',0])await assert.rejects(resolveHerdrExecutable({runtime:{herdr:path},herdrExecutable:process.execPath,env:{PATH:bin}}),{code:'herdr_not_found'});
 await assert.rejects(recordHerdrRuntime({home,runtime:{},herdr:executable,lease:{}}),{code:'lock_unavailable'});
 assert.equal((await readInstallRecord({home})).value,null);
});
test('CLI new preparation loads setup binding but prepared resume readiness uses saved runtime',async t=>{
 const {home,executable}=await fixture(t),runtime={releaseId:'synthetic'},stdout=capture(),stderr=capture();
 await withUpdateLock({home},lease=>recordHerdrRuntime({home,runtime,herdr:executable,lease}));
 const runId='123e4567-e89b-42d3-a456-426614174000';let calls=0;
 const code=await runPdd(['workflow','run','small-change','17'],{home,stdout,stderr,ports:{runtime,env:{PATH:''}},
  workflowModels:{resolveWorkflowLaunchModel:async()=>({state:'selected',selection:{agent:'codex'}})},
  workflowRunner:{prepareWorkflow:async(input,ports)=>{assert.equal(ports.runtime.herdr,executable);return {state:'prepared',runId,runtime:ports.runtime};}},
  workflowHerdrBoot:{ensureDefaultHerdr:async ports=>{calls++;assert.equal(ports.runtime.herdr,executable);return {state:'ready',code:null,executable};}},
  workflowController:{startWorkflowController:async(input,ports)=>{assert.equal(ports.runtime.herdr,executable);return {state:'refused',code:'herdr_not_found',message:`Herdr not found at ${executable}`};}}});
 assert.equal(code,1);assert.equal(calls,1);assert.match(stderr.text,/refused \(herdr_not_found\)/);assert.ok(stderr.text.includes(`Herdr not found at ${executable}`));assert.deepEqual(runtime,{releaseId:'synthetic'});
});
