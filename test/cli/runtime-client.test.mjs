import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import {runRuntimeCommand} from '../../src/runtime-client.mjs';

const capture = () => ({text: '', write(value) { this.text += value; }});

test('runtime client refuses an unconfigured service and missing GitHub login plainly', async () => {
  const stdout = capture(), stderr = capture();
  assert.equal(await runRuntimeCommand('lint', {}, {env: {}, stdout, stderr}), 1);
  assert.equal(stderr.text, 'The runtime service is not configured yet.\n');
  const second = capture(), secondErr = capture();
  assert.equal(await runRuntimeCommand('lint', {}, {env: {PDD_RUNTIME_URL: 'https://runtime.example'}, stdout: second, stderr: secondErr, githubToken: ''}), 1);
  assert.equal(secondErr.text, 'Sign in to GitHub first: gh auth login\n');
});

test('runtime check sends one authenticated idempotent request and prints recovery first', async t => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push({request, body}); response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({verdict: 'passed', calls: 2, link: 'https://runtime.example/r/r1'}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const stdout = capture(), stderr = capture();
  const code = await runRuntimeCommand('check', {scenario: 'scenarios/order.json', maxCalls: '4'}, {
    env: {PDD_RUNTIME_URL: `http://127.0.0.1:${server.address().port}`}, githubToken: 'never-print-me', stdout, stderr
  });
  assert.equal(code, 0); assert.equal(stderr.text, ''); assert.equal(requests.length, 1);
  assert.equal(requests[0].request.url, '/v1/check'); assert.deepEqual(JSON.parse(requests[0].body), {scenario: 'scenarios/order.json', maxCalls: 4});
  assert.match(requests[0].request.headers.authorization, /^Bearer /); assert.match(requests[0].request.headers['idempotency-key'], /^[0-9a-f-]{36}$/);
  assert.ok(stdout.text.startsWith('If this stops, run: pdd runs show ')); assert.doesNotMatch(stdout.text, /never-print-me/);
});

test('try accepts only HTTPS links and terminal mode reports command fields', async t => {
  let mode = 'bad';
  const server = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/try' && mode === 'bad') response.end(JSON.stringify({link: 'http://unsafe.example/s/x'}));
    else if (request.url === '/v1/try') response.end(JSON.stringify({token: 'tok', link: 'https://runtime.example/s/tok/'}));
    else response.end(JSON.stringify({stdout: 'hello', stderr: 'warning', exitCode: 0, callsLeft: 3}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const badOut = capture(), badErr = capture();
  assert.equal(await runRuntimeCommand('try', {}, {env: {PDD_RUNTIME_URL: `http://127.0.0.1:${server.address().port}`}, githubToken: 'x', stdout: badOut, stderr: badErr}), 1);
  assert.match(badErr.text, /not a valid HTTPS URL/);
  mode = 'good'; const stdout = capture(), stderr = capture();
  assert.equal(await runRuntimeCommand('try', {terminal: true}, {env: {PDD_RUNTIME_URL: `http://127.0.0.1:${server.address().port}`}, githubToken: 'x', stdout, stderr, input: Readable.from(['hello\n'])}), 0);
  assert.match(stdout.text, /https:\/\/runtime\.example\/s\/tok\//); assert.match(stdout.text, /exit code: 0/); assert.match(stdout.text, /calls left: 3/); assert.match(stderr.text, /warning/);
});
