import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listLocalWorkflows,formatLocalWorkflows} from '../../src/workflow-list.mjs';
import vectors from '../../vectors/cli/workflow-list.json' with {type:'json'};
for(const c of vectors.cases)test(c.id,t=>{
  const cwd=mkdtempSync(join(tmpdir(),'pdd-list-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));const root=join(cwd,'.pdd','workflows');
  if(c.given.regularRecipes)for(const recipe of c.given.regularRecipes){mkdirSync(join(root,recipe,'..'),{recursive:true});writeFileSync(join(root,recipe),'Manual instructions');}
  if(c.id==='symlink-not-followed'){mkdirSync(root,{recursive:true});const target=join(cwd,'outside');mkdirSync(target);writeFileSync(join(target,'WORKFLOW.md'),'outside');symlinkSync(target,join(root,'linked'));assert.deepEqual(listLocalWorkflows({cwd}).workflows,[]);}
  else if(c.expected.catalog)assert.deepEqual(listLocalWorkflows({cwd}),c.expected.catalog);
  else if(c.id==='read-error')assert.throws(()=>listLocalWorkflows({cwd,stat:()=>({isDirectory:()=>true,isSymbolicLink:()=>false}),readDir:()=>{throw Object.assign(Error('access denied'),{code:'EACCES'});}}),/access denied/);
  else if(c.when.json)assert.deepEqual(JSON.parse(formatLocalWorkflows(c.given.catalog,{json:true})),c.expected.json);
  else {const text=formatLocalWorkflows({workflows:[{name:'feature',source:'bundled'}],default:null});assert.match(text,/Listing starts no work/);assert.match(text,/workflow run/);}
});
