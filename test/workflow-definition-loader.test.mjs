import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadWorkflowDefinition, listWorkflowDefinitions } from '../src/workflow-definition-loader.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'pdd-definition-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'project'), packageRoot = join(root, 'package');
  mkdirSync(cwd); mkdirSync(packageRoot);
  return { cwd, packageRoot };
}
function sample(name = 'repair-label') {
  return { version: 1, name, overview: 'WORKFLOW.md', stages: [
    { id: 'expect', kind: 'agent', file: 'expect.md', protocol: 'proposal', requiredRoles: ['prompt','story','cases'], approval: 'next-advance' },
    { id: 'edit', kind: 'agent', file: 'edit.md', protocol: 'work' },
    { id: 'measure', kind: 'agent', file: 'measure.md', protocol: 'verify' },
    { id: 'publish', kind: 'pr', file: 'publish.md', publication: 'verified' },
    { id: 'observe', kind: 'merge', file: 'observe.md', prStage: 'publish' }
  ] };
}
function put(root, data) {
  const directory = join(root, '.pdd', 'workflows', data.name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'workflow.json'), JSON.stringify(data));
  for (const path of new Set([data.overview, ...data.stages.map(stage => stage.file)])) {
    if (path.includes('..') || path.startsWith('/')) continue;
    writeFileSync(join(directory, path), `Instructions for ${path}.\n`);
  }
  return directory;
}

test('arbitrary safe names and renamed semantic stages load without a PDD code change', t => {
  const options = setup(t); put(options.packageRoot, sample());
  const loaded = loadWorkflowDefinition({ ...options, name: 'repair-label' });
  assert.deepEqual(loaded.stages.map(stage => stage.id), ['expect', 'edit', 'measure', 'publish', 'observe']);
  assert.deepEqual(loaded.stages.map(stage => stage.kind), ['agent', 'agent', 'agent', 'pr', 'merge']);
  assert.equal(loaded.files.length, 7);
  assert.equal(loaded.files.find(file => file.path === 'expect.md').content, 'Instructions for expect.md.\n');
  assert.equal(loaded.files.find(file => file.path === 'expect.md').sha256, hash('Instructions for expect.md.\n'));
  assert.deepEqual(listWorkflowDefinitions(options), [{ name: 'repair-label', source: 'bundled' }]);
});
test('whole local override wins; missing or malformed local config never falls back', t => {
  const options = setup(t); put(options.packageRoot, sample());
  const directory = join(options.cwd, '.pdd', 'workflows', 'repair-label'); mkdirSync(directory, { recursive: true });
  assert.throws(() => loadWorkflowDefinition({ ...options, name: 'repair-label' }), /ENOENT/);
  writeFileSync(join(directory, 'workflow.json'), '{');
  assert.throws(() => loadWorkflowDefinition({ ...options, name: 'repair-label' }), /malformed/);
  put(options.cwd, sample()); writeFileSync(join(directory, 'edit.md'), 'Project-specific real instructions.');
  const loaded = loadWorkflowDefinition({ ...options, name: 'repair-label' });
  assert.equal(loaded.root, directory);
  assert.equal(loaded.files.find(file => file.path === 'edit.md').content, 'Project-specific real instructions.');
  assert.deepEqual(listWorkflowDefinitions(options), [{ name: 'repair-label', source: 'project' }]);
});
test('snapshot bytes and digest remain immutable; later Markdown or JSON edits produce a new digest', t => {
  const options = setup(t), directory = put(options.cwd, sample());
  const first = loadWorkflowDefinition({ ...options, name: 'repair-label' });
  assert.throws(() => { first.stages[0].id = 'changed'; }, TypeError);
  assert.throws(() => { first.files.push({}); }, TypeError);
  writeFileSync(join(directory, 'edit.md'), 'Revised behavior.');
  const second = loadWorkflowDefinition({ ...options, name: 'repair-label' });
  assert.notEqual(second.digest, first.digest);
  assert.equal(first.files.find(file => file.path === 'edit.md').content, 'Instructions for edit.md.\n');
  const changed = sample(); changed.stages[1].optional = true; writeFileSync(join(directory, 'workflow.json'), JSON.stringify(changed));
  assert.notEqual(loadWorkflowDefinition({ ...options, name: 'repair-label' }).digest, second.digest);
});
for (const path of ['workflow.json', 'WORKFLOW.md', 'edit.md']) {
  test(`UTF-8 BOM round-trip preserves selected ${path} bytes and immutable snapshot hashes`, t => {
    const options = setup(t), directory = put(options.cwd, sample());
    const plain = path === 'workflow.json' ? readFileSync(join(directory, path)) : Buffer.from('# Café 👋\r\nSelected instructions.\n');
    const selected = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), plain]);
    writeFileSync(join(directory, path), selected);
    const loaded = loadWorkflowDefinition({ ...options, name: 'repair-label' });
    const file = loaded.files.find(file => file.path === path);
    assert.deepEqual(Buffer.from(file.content, 'utf8'), selected);
    assert.equal(file.sha256, hash(selected));
    assert.equal(hash(Buffer.from(file.content, 'utf8')), file.sha256);
    assert.deepEqual(Buffer.from(JSON.parse(JSON.stringify(file)).content, 'utf8'), selected);
    assert.deepEqual(listWorkflowDefinitions(options), [{ name: 'repair-label', source: 'project' }]);
    writeFileSync(join(directory, path), plain);
    const later = loadWorkflowDefinition({ ...options, name: 'repair-label' });
    assert.notEqual(later.digest, loaded.digest);
    assert.deepEqual(later.stages, loaded.stages);
    assert.deepEqual(Buffer.from(file.content, 'utf8'), selected);
  });
}
test('UTF-8 BOM never permits malformed UTF-8 in metadata, overview or stage instructions', t => {
  const options = setup(t);
  for (const path of ['workflow.json', 'WORKFLOW.md', 'edit.md']) {
    const directory = put(options.cwd, sample());
    writeFileSync(join(directory, path), Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0x28]));
    assert.throws(() => loadWorkflowDefinition({ ...options, name: 'repair-label' }), TypeError);
  }
});
test('UTF-8 BOM bytes count toward the inclusive file size limit', t => {
  const options = setup(t), directory = put(options.cwd, sample());
  const selected = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.alloc(256 * 1024 - 3, 'x')]);
  writeFileSync(join(directory, 'edit.md'), selected);
  const loaded = loadWorkflowDefinition({ ...options, name: 'repair-label' });
  assert.deepEqual(Buffer.from(loaded.files.find(file => file.path === 'edit.md').content), selected);
  writeFileSync(join(directory, 'edit.md'), Buffer.concat([selected, Buffer.from('x')]));
  assert.throws(() => loadWorkflowDefinition({ ...options, name: 'repair-label' }), /bounded/);
});
test('UTF-8 BOM bytes count toward the inclusive aggregate snapshot size limit', t => {
  const options = setup(t), definition = sample();
  definition.stages = Array.from({ length: 8 }, (_, index) => ({ id: `report-${index}`, kind: 'agent', protocol: 'report', file: `report-${index}.md` }));
  const directory = put(options.cwd, definition), bom = Buffer.from([0xef, 0xbb, 0xbf]);
  let remaining = 2 * 1024 * 1024 - readFileSync(join(directory, 'workflow.json')).length - readFileSync(join(directory, 'WORKFLOW.md')).length;
  for (const stage of definition.stages) {
    const size = Math.min(256 * 1024, remaining);
    writeFileSync(join(directory, stage.file), Buffer.concat([bom, Buffer.alloc(size - bom.length, 'x')]));
    remaining -= size;
  }
  assert.equal(remaining, 0);
  const load = () => loadWorkflowDefinition({ ...options, name: 'repair-label' });
  assert.equal(load().files.reduce((size, file) => size + Buffer.byteLength(file.content), 0), 2 * 1024 * 1024);
  const last = join(directory, definition.stages.at(-1).file);
  writeFileSync(last, Buffer.concat([readFileSync(last), Buffer.from('x')]));
  assert.throws(load, /snapshot exceeds 2MiB/);
});
test('discovery unions actual project and bundled names without hardcoding three recipes', t => {
  const options = setup(t); put(options.packageRoot, sample('zeta')); put(options.cwd, sample('alpha')); put(options.cwd, sample('zeta'));
  assert.deepEqual(listWorkflowDefinitions(options), [{ name: 'alpha', source: 'project' }, { name: 'zeta', source: 'project' }]);
});
test('finite schema rejects duplicate IDs, unknown fields, invalid types and execution kinds', t => {
  const options = setup(t);
  const changes = [d => d.stages.push(d.stages[0]), d => { d.stages[1].kind = 'shell'; },
    d => { d.version = 2; }, d => { d.secret = true; }, d => { d.stages[1].optional = 'false'; },
    d => { d.stages[1].argv = ['sh', '-c', 'anything']; }, d => { d.stages[0].requiredRoles = ['cases', 'cases']; },
    d => { d.stages[0].approval = 'implicit'; }, d => { d.stages[1].approval = 'human'; }];
  for (const change of changes) {
    const d = sample(); change(d); put(options.cwd, d);
    assert.throws(() => loadWorkflowDefinition({ ...options, name: d.name }));
  }
});
test('graph refuses forward/wrong-kind references and unapproved or unverified publication', t => {
  const options = setup(t);
  const changes = [d => { d.stages[1].requiresMerge = 'observe'; }, d => { d.stages[4].prStage = 'edit'; },
    d => { d.stages[0].approval = 'human'; }, d => { d.stages[2].optional = true; },
    d => { d.stages.splice(2, 1); }, d => { d.stages.push({ ...d.stages[4], id: 'another-merge' }); },
    d => { d.stages[4].optional = true; }];
  for (const change of changes) {
    const d = sample(); change(d); put(options.cwd, d);
    assert.throws(() => loadWorkflowDefinition({ ...options, name: d.name }));
  }
});
test('human proposal approval and optional proposal PR merge dependencies are explicit', t => {
  const options = setup(t), d = sample('full-feature'); d.stages[0].approval = 'human';
  d.stages.splice(1, 0, { id: 'accept', kind: 'human', file: 'accept.md' },
    { id: 'contract-pr', kind: 'pr', file: 'contract-pr.md', publication: 'proposal', optional: true },
    { id: 'contract-merge', kind: 'merge', file: 'contract-merge.md', prStage: 'contract-pr' });
  d.stages.find(stage => stage.id === 'edit').requiresMerge = 'contract-merge';
  put(options.cwd, d);
  const loaded = loadWorkflowDefinition({ ...options, name: d.name });
  assert.equal(loaded.stages.find(stage => stage.id === 'edit').requiresMerge, 'contract-merge');
});
test('traversal, absolute paths, malformed names and undeclared-file loading refuse', t => {
  const options = setup(t);
  for (const name of ['../outside', '/absolute', 'bad_name', 'UPPER', 'x'.repeat(65), 'a--b']) {
    assert.throws(() => loadWorkflowDefinition({ ...options, name }), /invalid workflow name/);
  }
  for (const file of ['../outside.md', '/absolute.md', 'a/../outside.md', 'a\\outside.md', '.git/config.md']) {
    const d = sample(); d.stages[1].file = file;
    const directory = join(options.cwd, '.pdd', 'workflows', d.name); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'workflow.json'), JSON.stringify(d));
    assert.throws(() => loadWorkflowDefinition({ ...options, name: d.name }), /contained Markdown/);
  }
});
test('recipe directory, instruction and metadata-parent symlinks cannot escape selection', t => {
  const options = setup(t), directory = put(options.packageRoot, sample());
  mkdirSync(join(options.cwd, '.pdd', 'workflows'), { recursive: true });
  symlinkSync(directory, join(options.cwd, '.pdd', 'workflows', 'repair-label'));
  assert.throws(() => loadWorkflowDefinition({ ...options, name: 'repair-label' }), /noncanonical/);
  rmSync(join(options.cwd, '.pdd'), { recursive: true });
  symlinkSync(join(options.packageRoot, '.pdd'), join(options.cwd, '.pdd'));
  assert.throws(() => loadWorkflowDefinition({ ...options, name: 'repair-label' }), /noncanonical/);
  rmSync(join(options.cwd, '.pdd'));
  const local = put(options.cwd, sample()); rmSync(join(local, 'edit.md')); symlinkSync(join(directory, 'edit.md'), join(local, 'edit.md'));
  assert.throws(() => loadWorkflowDefinition({ ...options, name: 'repair-label' }), /ordinary/);
});
test('hardlinked and oversized files refuse instead of reading mutable aliases or unbounded context', t => {
  const options = setup(t), directory = put(options.cwd, sample());
  linkSync(join(directory, 'edit.md'), join(directory, 'alias.md'));
  assert.throws(() => loadWorkflowDefinition({ ...options, name: 'repair-label' }), /ordinary/);
  rmSync(join(directory, 'alias.md'));
  writeFileSync(join(directory, 'edit.md'), 'x'.repeat(256 * 1024 + 1));
  assert.throws(() => loadWorkflowDefinition({ ...options, name: 'repair-label' }), /bounded/);
});

test('verified publication requires mandatory verification after every later work stage, independent of stage IDs', t => {
  const options=setup(t), d=sample('latest-work');
  d.stages.splice(3,0,{id:'more-editing',kind:'agent',protocol:'work',file:'later.md'});put(options.cwd,d);
  assert.throws(()=>loadWorkflowDefinition({...options,name:d.name}),/PR requires/);
  d.stages.splice(4,0,{id:'measure-again',kind:'agent',protocol:'verify',file:'again.md'});put(options.cwd,d);
  assert.equal(loadWorkflowDefinition({...options,name:d.name}).stages[4].id,'measure-again');
  d.stages.splice(4,1);d.stages.find(stage=>stage.id==='publish').publication='proposal';put(options.cwd,d);
  assert.equal(loadWorkflowDefinition({...options,name:d.name}).stages.find(stage=>stage.id==='publish').publication,'proposal');
});
