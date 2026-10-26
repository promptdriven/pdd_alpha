import test from 'node:test';
import assert from 'node:assert/strict';
import cases from '../vectors/cli/native-flags.json' with { type: 'json' };
import { nativeArgs } from '../src/native-flags.mjs';

const expand = value => value && typeof value === 'object' && '$repeat' in value
  ? String(value.$repeat[0]).repeat(value.$repeat[1])
  : Array.isArray(value) ? value.map(expand)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k, expand(v)])) : value;

for (const vector of cases.cases) test(`native flags: ${vector.id}`, () => {
  if (vector.when.calls && vector.expected?.throws) {
    for (const call of vector.when.calls) assert.throws(()=>nativeArgs(expand(call.args)),{name:vector.expected.throws},vector.id);
    return;
  }
  if (vector.when.calls) {
    const input = expand(vector.when.calls[0].args);
    const first = nativeArgs(input), second = nativeArgs(expand(vector.when.calls[1].args));
    assert.deepEqual(first, expand(vector.expected.results[0]), vector.id);
    assert.deepEqual(second, expand(vector.expected.results[1]), vector.id);
    assert.notStrictEqual(first, second, vector.id);
    for (const forbidden of vector.expected.mustNotContain ?? []) {
      assert.ok(!first.includes(forbidden), `${vector.id}: forbidden ${forbidden}`);
      assert.ok(!second.includes(forbidden), `${vector.id}: forbidden ${forbidden}`);
    }
    assert.deepEqual(input, expand(vector.expected.inputAfter), vector.id);
    return;
  }
  const input = expand(vector.when.args);
  if (vector.expectedError) assert.throws(() => nativeArgs(input), { name: vector.expectedError }, vector.id);
  else assert.deepEqual(nativeArgs(input), expand(vector.expected), vector.id);
});

test('native flags accept a Unicode scalar pair and reject lone surrogates', () => {
  assert.equal(nativeArgs({agent:'codex', cwd:'/tmp/📱'})[6], 'projects={"/tmp/📱"={trust_level="trusted"}}');
  for (const cwd of ['/tmp/\ud800', '/tmp/\udfff']) assert.throws(() => nativeArgs({agent:'codex', cwd}), TypeError);
});
