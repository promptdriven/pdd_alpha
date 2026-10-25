import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { resolveRuntime, collectVersions } from '../../src/versions.mjs';
import { cases, temporary, runtime, pointer, put } from './pkg-fixtures.mjs';

for (const c of await cases('versions')) test(c.id, async t => {
  const home = await temporary(t);
  if (['complete-runtime', 'alpha-only-runtime', 'explicit-root-missing', 'path-escape', 'runtime-pinning-does-not-pin-account', 'model-effort-is-not-runtime-selection', 'later-stage-stays-pinned'].includes(c.id)) {
    const r2 = await runtime(home, 'R2', { client: c.id === 'complete-runtime' }); await pointer(home, 'current', r2);
    if (c.id === 'explicit-root-missing') { await assert.rejects(resolveRuntime({ home, versionRoot: join(home, '.pdd/versions/R1') }), { code: c.expected.code }); return; }
    if (c.id === 'path-escape') {
      await fs.unlink(r2.bin); await put(join(home, 'foreign.mjs'), 'throw Error()'); await fs.symlink(join(home, 'foreign.mjs'), r2.bin);
      await assert.rejects(resolveRuntime({ home }), { code: c.expected.code }); return;
    }
    let lookups = 0;
    const selected = await resolveRuntime({ home }, { fs: { ...fs, realpath: async path => { if (path.endsWith('/current')) lookups++; return fs.realpath(path); } } });
    assert.equal(selected.versionRoot, r2.versionRoot); assert.equal(lookups, 1); assert.equal(selected.bin, r2.bin);
    if (c.id === 'alpha-only-runtime') { assert.equal(selected.clientDigest, c.expected.clientDigest); assert.equal(selected.credentialHelper, c.expected.credentialHelper); }
    if (c.id === 'complete-runtime') assert.equal(selected.credentialHelper, r2.credentialHelper);
    const r4 = await runtime(home, 'R4'); await fs.unlink(join(home, '.pdd/current')); await pointer(home, 'current', r4);
    assert.deepEqual(await resolveRuntime({ home, versionRoot: selected.versionRoot }), selected);
    assert.equal('account' in selected, false); assert.equal('model' in selected, false); return;
  }
  const ids = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'], installed = {};
  for (const [n, id] of ids.entries()) installed[id] = await runtime(home, id, { nodeVersion: `22.16.${n}` });
  const currentId = c.given.current ?? 'R5', previousId = c.given.previous ?? 'R4';
  await pointer(home, 'current', installed[currentId]); if (previousId !== currentId) await pointer(home, 'previous', installed[previousId]);
  await put(join(home, 'worktree/unique'), 'retain'); await put(join(home, '.pdd/update/staging/T1/partial'), 'retain');
  let refs = ids.map(id => installed[id]);
  if (c.id === 'only-owned-unused-folders') refs = ids.filter(id => id !== 'R1').map(id => installed[id]);
  const complete = c.id !== 'partial-reference-inventory';
  let reads = 0;
  const references = async () => {
    reads++;
    if (c.id === 'reference-appears-before-delete') return { complete: true, references: reads === 1 ? refs.filter(r => r.releaseId !== 'R1') : refs };
    return { complete, references: refs };
  };
  const collected = await collectVersions({ home, references });
  if (c.id === 'partial-reference-inventory') { assert.equal(collected.code, c.expected.code); assert.deepEqual(collected.removed, c.expected.removed); }
  else {
    assert.equal(collected.code, null);
    assert.deepEqual(collected.removed, c.expected.removed ?? []);
    for (const id of c.expected.retained ?? c.expected.retainedIncludes ?? ids.filter(id => !collected.removed.includes(id))) assert.ok(collected.retained.includes(id), id);
    if (c.id === 'only-owned-unused-folders') await assert.rejects(fs.lstat(installed.R1.versionRoot), { code: 'ENOENT' });
  }
  assert.equal(await fs.readFile(join(home, 'worktree/unique'), 'utf8'), 'retain');
  assert.equal(await fs.readFile(join(home, '.pdd/update/staging/T1/partial'), 'utf8'), 'retain');
});

test('unstable final census deletes no package or Node', async t => {
  const home = await temporary(t), r1 = await runtime(home), r2 = await runtime(home, 'R2'); await pointer(home, 'current', r2);
  let calls = 0;
  const result = await collectVersions({ home, references: () => ({ complete: true, references: ++calls >= 3 ? [r1] : [] }) });
  assert.equal(result.code, 'references_uncertain'); await fs.stat(r1.versionRoot);
});
