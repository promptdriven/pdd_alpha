import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runRuntimeCommand} from '../../src/runtime-client.mjs';

const capture = () => ({text: '', write(value) { this.text += value; }});
function repo() { const root = mkdtempSync(join(tmpdir(), 'pdd-client-test-')); execFileSync('git', ['init', '-q'], {cwd: root}); writeFileSync(join(root, 'scenario.json'), '{}'); writeFileSync(join(root, 'seed.json'), '{}'); execFileSync('git', ['add', '.'], {cwd: root}); return root; }
function server(handler) { const instance = http.createServer(handler); return new Promise(resolve => instance.listen(0, '127.0.0.1', () => resolve(instance))); }
const id = '11111111-1111-4111-8111-111111111111';
const base = instance => `http://127.0.0.1:${instance.address().port}`;

test('configuration is checked before source capture', async () => {
  const stdout = capture(), stderr = capture();
  assert.equal(await runRuntimeCommand('check', {scenario: 'scenario.json'}, {env: {}, cwd: '/does/not/exist', stdout, stderr}), 1);
  assert.equal(stderr.text, 'The runtime service is not configured yet.\n');
});

test('check submits multipart source once with request identity and recovery command', async t => {
  const requests = []; const instance = await server(async (request, response) => { let bytes = 0; for await (const chunk of request) bytes += chunk.length; requests.push({request, bytes}); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({requestId: id, id, command: 'check', state: 'passed', result: {outcome: 'Pass'}, report_url: 'https://runtime.example/r/independent'})); }); t.after(() => instance.close());
  const stdout = capture(), stderr = capture(); const code = await runRuntimeCommand('check', {scenario: 'scenario.json'}, {cwd: repo(), env: {PDD_RUNTIME_URL: base(instance)}, githubToken: 'do-not-print', stdout, stderr, randomUUID: () => id});
  assert.equal(code, 0); assert.equal(requests.length, 1); assert.match(requests[0].request.headers.authorization, /^Bearer /); assert.match(requests[0].request.headers['content-type'], /^multipart\/form-data/); assert.match(stderr.text, new RegExp(`pdd check --request '${id}'`)); assert.doesNotMatch(stdout.text, /do-not-print/);
});

test('accepted jobs are read by the same id until terminal', async t => {
  let reads = 0; const instance = await server(async (request, response) => { for await (const _ of request) {} response.setHeader('content-type', 'application/json'); if (request.method === 'POST') response.end(JSON.stringify({requestId: id, id, command: 'check', state: 'queued', result: null})); else { reads++; response.end(JSON.stringify({requestId: id, id, command: 'check', state: 'failed', result: {outcome: 'Fail', why: 'criterion failed'}})); } }); t.after(() => instance.close());
  const stdout = capture(), stderr = capture(); assert.equal(await runRuntimeCommand('check', {scenario: 'scenario.json'}, {cwd: repo(), env: {PDD_RUNTIME_URL: base(instance)}, githubToken: 'x', stdout, stderr, randomUUID: () => id}), 1); assert.equal(reads, 1); assert.match(stdout.text, /criterion failed/);
});

test('request recovery performs only the owner-scoped GET and maps unknown exactly', async t => {
  let posts = 0; const instance = await server(async (request, response) => { if (request.method === 'POST') posts++; for await (const _ of request) {} response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({requestId: id, id, command: 'check', state: 'unknown', result: {outcome: 'Inconclusive'}})); }); t.after(() => instance.close());
  const stdout = capture(), stderr = capture(); assert.equal(await runRuntimeCommand('check', {request: id}, {env: {PDD_RUNTIME_URL: base(instance)}, githubToken: 'x', stdout, stderr}), 3); assert.equal(posts, 0); assert.match(stderr.text, new RegExp(`pdd check --request '${id}'`)); assert.match(stdout.text, /result is unknown/);
});

test('try stop sends request id in X-Request-Id', async t => {
  let header; const instance = await server(async (request, response) => { header = request.headers['x-request-id']; for await (const _ of request) {} response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({requestId: id, id, command: 'stop', state: 'passed', result: {exitCode: 0, output: 'Try stopped.'}})); }); t.after(() => instance.close());
  const stdout = capture(), stderr = capture(); assert.equal(await runRuntimeCommand('try-stop', {id: 'try-id'}, {env: {PDD_RUNTIME_URL: base(instance)}, githubToken: 'x', stdout, stderr, randomUUID: () => id}), 0); assert.equal(header, id); assert.match(stdout.text, /Try stopped/);
});
