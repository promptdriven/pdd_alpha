import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vectors from '../../vectors/cli/workflow-definition-loader.json' with {type:'json'};
import {loadWorkflowDefinition,listWorkflowDefinitions} from '../../src/workflow-definition-loader.mjs';
function setup(t) {const base=mkdtempSync(join(tmpdir(),'pdd-loader-vectors-'));t.after(()=>rmSync(base,{recursive:true,force:true}));const cwd=join(base,'project'),packageRoot=join(base,'package');mkdirSync(cwd);mkdirSync(packageRoot);return {cwd,packageRoot,name:'custom-flow'};}
function definition(name='custom-flow') {return {version:1,name,overview:'overview.md',stages:[{id:'specify',kind:'agent',file:'stage.md',protocol:'proposal',requiredRoles:['prompt','story','cases'],approval:'next-advance'},
 {id:'work',kind:'agent',file:'work.md',protocol:'work'},{id:'verify',kind:'agent',file:'verify.md',protocol:'verify'},{id:'publish',kind:'pr',file:'publish.md',publication:'verified'}]};}
function put(base,d=definition()) {const dir=join(base,'.pdd/workflows',d.name);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'workflow.json'),JSON.stringify(d));for(const f of [d.overview,...d.stages.map(s=>s.file)].filter(p=>!p.includes('..')))writeFileSync(join(dir,f),'Selected instructions.\n');return dir;}
for(const v of vectors.cases)test(v.id,t=>{
 const p=setup(t),d=definition(),load=()=>loadWorkflowDefinition(p),e=v.expected;
 switch(v.id) {
 case 'project-overrides-bundle':put(p.packageRoot);put(p.cwd);assert.equal(load().root,join(p.cwd,'.pdd/workflows/custom-flow'));break;
 case 'invalid-local-refuses':put(p.packageRoot);mkdirSync(join(p.cwd,'.pdd/workflows/custom-flow'),{recursive:true});assert.throws(load);break;
 case 'bundle-when-local-absent':put(p.packageRoot);assert.equal(load().root,join(p.packageRoot,'.pdd/workflows/custom-flow'));break;
 case 'safe-content':d.stages[1].file=v.given.instruction;put(p.cwd,d);assert.throws(load);break;
 case 'exact-snapshot':{d.stages=d.stages.slice(0,1);const dir=put(p.cwd,d),first=load();assert.deepEqual(first.files.map(f=>f.path),e.orderedPaths);writeFileSync(join(dir,'stage.md'),'Changed instructions.');assert.notEqual(first.digest,load().digest);assert.equal(first.files.find(f=>f.path==='stage.md').content,'Selected instructions.\n');break;}
 case 'immutable-output':put(p.cwd);{const first=load();assert.throws(()=>{first.stages[0].id='mutated';},TypeError);assert.equal(first.stages[0].id,'specify');}break;
 case 'stage-boundary':for(const count of v.given.stageCounts){d.stages=[definition().stages[0],...Array.from({length:count-1},(_,i)=>({id:'report-'+i,kind:'agent',protocol:'report',file:'stage.md'}))];put(p.cwd,d);if(e.acceptedCounts.includes(count))assert.equal(load().stages.length,count);else assert.throws(load);}break;
 case 'file-boundary':{const dir=put(p.cwd);for(const size of v.given.fileSizesBytes){writeFileSync(join(dir,'stage.md'),'x'.repeat(size));if(e.acceptedSizes.includes(size))assert.equal(load().files.find(f=>f.path==='stage.md').content.length,size);else assert.throws(load);}break;}
 case 'approval-graph':d.stages.unshift(d.stages.splice(1,1)[0]);put(p.cwd,d);assert.throws(load);break;
 case 'verify-after-work':d.stages.splice(3,0,{id:'later-work',kind:'agent',protocol:'work',file:'stage.md'});put(p.cwd,d);assert.throws(load);break;
 case 'merge-binding':d.stages[1].requiresMerge='publish';put(p.cwd,d);assert.throws(load);break;
 case 'arbitrary-safe-names':for(const name of v.given.names)put(p.cwd,definition(name));assert.deepEqual(listWorkflowDefinitions(p).map(r=>r.name),e.names);break;
 case 'invalid-discovery':put(p.cwd);{const bad=definition('invalid');bad.stages[1].kind='shell';put(p.cwd,bad);assert.throws(()=>listWorkflowDefinitions(p),/invalid/);}break;
 case 'pdd-specification-gate':d.stages[0].requiredRoles=v.given.proposalRoles;put(p.cwd,d);assert.throws(load,/proposal/);break;
 default:assert.fail('Unmapped loader vector');
 }
});
