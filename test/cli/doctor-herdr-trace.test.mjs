import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runDoctorCommand} from '../../src/doctor.mjs';
import {traceHerdrRequest,readHerdrTrace} from '../../src/herdr-trace.mjs';
import {runPdd} from '../../src/pdd-cli.mjs';
const capture=()=>({text:'',write(x){this.text+=x;}});
const pass={id:'runtime',state:'pass',detail:'Runtime checked.',next:null};
test('doctor report includes only last 200 trusted local trace records and never adapter trace text',async t=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'pdd-doctor-trace-')));t.after(()=>rmSync(home,{recursive:true,force:true}));const ports={home,env:{PDD_TRACE:'herdr'}};
  for(let i=0;i<105;i++)await traceHerdrRequest({operation:'pane.process_info'},()=>({pid:i+1,pane_id:'w1:p1'}),ports);
  const path=join(home,'.pdd/logs/herdr-trace.jsonl'),before=readFileSync(path);const stdout=capture();
  assert.equal(await runPdd(['doctor','--report'],{home,stdout,stderr:capture(),doctorDeps:{alphaChecks:async()=>({checks:[pass],report:{herdrTrace:['sk-secret-should-not-print']}})}}),0);
  const report=JSON.parse(stdout.text);assert.deepEqual(report.herdrTrace,readHerdrTrace(ports));assert.equal(report.herdrTrace.length,200);assert.doesNotMatch(stdout.text,/sk-secret/);assert.deepEqual(readFileSync(path),before);
});
test('report without tracing writes nothing; ordinary doctor modes do not include trace',async t=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'pdd-doctor-no-trace-')));t.after(()=>rmSync(home,{recursive:true,force:true}));
  for(const argv of [['--report'],['--json'],['--check-only'],[]]){
    const stdout=capture();assert.equal(await runDoctorCommand(argv,{home,stdout,stderr:capture(),alphaChecks:async()=>({checks:[pass]})}),0);
    if(argv[0]==='--report')assert.deepEqual(JSON.parse(stdout.text).herdrTrace,[]);else assert.doesNotMatch(stdout.text,/herdrTrace/);
    assert.equal(existsSync(join(home,'.pdd')),false);
  }
});
