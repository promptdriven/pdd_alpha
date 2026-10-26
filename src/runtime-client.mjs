// Generated from prompts/cli/runtime-client.prompt.md (sha256: e0d6ee77bd1e4b247a31fb27ec5173eacf7fed2685219f53e399e09efc235042).
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID as systemUUID} from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 30_000;
const HIDDEN_KEYS = /token|secret|password|authorization|credential|private.?key/i;
const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
const text = value => clean(value).trim();

function configuredOrigin(env) {
  const raw = text(env?.PDD_RUNTIME_URL);
  if (!raw) return {error: 'The runtime service is not configured yet.'};
  try {
    const url = new URL(raw);
    // Local HTTP is useful for a loopback fake server in tests. Hosted origins
    // and every non-loopback origin must be HTTPS.
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)
      || url.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
      return {error: 'The runtime service URL must use HTTPS.'};
    url.pathname = url.pathname.replace(/\/+$/, '');
    return {url};
  } catch { return {error: 'The runtime service URL is invalid.'}; }
}

async function githubToken(ports) {
  if (typeof ports.getGithubToken === 'function') {
    try { return text(await ports.getGithubToken()); } catch { return ''; }
  }
  if (ports.githubToken !== undefined) return text(ports.githubToken);
  if (ports.authToken !== undefined) return text(ports.authToken);
  try {
    const exec = ports.execFileSync ?? execFileSync;
    return text(exec('gh', ['auth', 'token'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}));
  } catch { return ''; }
}

function safeValue(value, depth = 0) {
  if (depth > 4 || value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return clean(value).slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => safeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) if (!HIDDEN_KEYS.test(key)) out[clean(key)] = safeValue(item, depth + 1);
    return out;
  }
  return undefined;
}

function verdict(value) {
  const raw = value?.verdict ?? value?.status ?? value?.outcome ?? value?.state ?? value?.result;
  if (raw === undefined && value?.ok === true) return 'passed';
  if (raw === undefined && value?.ok === false) return 'failed';
  return text(raw).toLowerCase();
}
function exitFor(value) {
  const state = verdict(value);
  if (['passed', 'pass', 'ok', 'success', 'succeeded', 'completed', 'complete', 'listed'].includes(state)) return 0;
  if (['failed', 'fail', 'error', 'rejected', 'refused'].includes(state)) return 1;
  return 3;
}
function validLink(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
function resultLink(value) {
  for (const key of ['url', 'link', 'href', 'reportUrl', 'previewUrl', 'tryUrl']) {
    const candidate = value?.[key];
    if (candidate !== undefined) return {present: true, value: validLink(candidate)};
  }
  for (const child of [value?.run, value?.result, value?.report]) {
    const nested = resultLink(child);
    if (nested.present) return nested;
  }
  return {present: false, value: null};
}

function qr(link) {
  // A compact, dependency-free terminal marker with QR finder geometry. It is
  // deliberately small enough for ordinary terminals and remains deterministic.
  const size = 21, cells = Array.from({length: size}, () => Array(size).fill(false));
  const finder = (ox, oy) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++)
    cells[oy + y][ox + x] = x === 0 || x === 6 || y === 0 || y === 6 || x >= 2 && x <= 4 && y >= 2 && y <= 4; };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  let seed = 2166136261;
  for (const char of link) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!cells[y][x]
    && !(x < 8 && y < 8) && !(x >= size - 8 && y < 8) && !(x < 8 && y >= size - 8)) {
    seed = Math.imul(seed ^ (x * 31 + y), 16777619) >>> 0; cells[y][x] = (seed & 1) === 1;
  }
  return cells.map(row => row.map(on => on ? '██' : '  ').join('')).join('\n');
}

export function createRuntimeClient(ports = {}) {
  const stdout = ports.stdout ?? process.stdout, stderr = ports.stderr ?? process.stderr;
  const write = (stream, value) => stream.write(`${value}\n`);
  const uuid = ports.randomUUID ?? systemUUID;
  const fetchImpl = ports.fetch ?? globalThis.fetch;
  const env = ports.env ?? process.env;
  async function request(method, path, body) {
    const origin = configuredOrigin(env);
    if (origin.error) { write(stderr, origin.error); return {kind: 'config', code: 1}; }
    const token = await githubToken(ports);
    if (!token) { write(stderr, 'Sign in to GitHub first: gh auth login'); return {kind: 'auth', code: 1}; }
    if (typeof fetchImpl !== 'function') { write(stderr, 'The runtime request could not be confirmed.'); return {kind: 'unknown', code: 3}; }
    const requestId = uuid();
    write(stdout, `If this stops, run: pdd runs show ${requestId}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ports.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const url = new URL(path, `${origin.url.href}/`);
      const response = await fetchImpl(url, {method, headers: {'Authorization': `Bearer ${token}`, 'Idempotency-Key': requestId,
        ...(body === undefined ? {} : {'Content-Type': 'application/json'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: controller.signal});
      let data = null;
      try { data = await response.json(); } catch { data = {}; }
      const ok = response.ok ?? (response.status === undefined || response.status >= 200 && response.status < 300);
      if (!ok) return {kind: response.status >= 500 || response.status === 408 || response.status === 429 ? 'unknown' : 'response', response, data, code: response.status >= 500 ? 3 : 1};
      return {kind: 'response', response, data};
    } catch { return {kind: 'unknown', code: 3}; }
    finally { clearTimeout(timer); }
  }
  const printSafe = value => write(stdout, text(value));
  function printLinkOrRefuse(data, required = false) {
    const link = resultLink(data);
    if ((link.present && !link.value) || (required && !link.value)) { write(stderr, 'The runtime returned a link that is not a valid HTTPS URL.'); return false; }
    if (link.value) { printSafe(link.value); write(stdout, 'QR:'); printSafe(qr(link.value)); }
    return true;
  }
  async function execute(command, input = {}) {
    if (command === 'lint') {
      const body = input.path === undefined ? {} : {path: input.path}; const result = await request('POST', '/v1/lint', body);
      if (result.kind !== 'response') return result.code ?? 3;
      printSafe(`Lint: ${verdict(result.data) || 'unknown'}.`);
      for (const item of result.data?.diagnostics ?? result.data?.errors ?? []) printSafe(typeof item === 'string' ? item : item.message ?? JSON.stringify(safeValue(item)));
      return exitFor(result.data);
    }
    if (command === 'check') {
      const body = {scenario: input.scenario, ...(input.maxCalls === undefined ? {} : {maxCalls: Number(input.maxCalls)})};
      const result = await request('POST', '/v1/check', body); if (result.kind !== 'response') return result.code ?? 3;
      const state = verdict(result.data) || 'unknown';
      if (input.json) printSafe(JSON.stringify(safeValue(result.data)));
      else {
        printSafe(`Check: ${state}.`);
        if (result.data?.reason) printSafe(text(result.data.reason));
        const criteria = result.data?.criteria ?? result.data?.failures ?? result.data?.failedCriteria;
        if (Array.isArray(criteria)) for (const item of criteria) {
          const expected = item?.expected === undefined ? '' : ` expected ${JSON.stringify(safeValue(item.expected))}`;
          const got = item?.got === undefined && item?.actual === undefined ? '' : ` got ${JSON.stringify(safeValue(item.got ?? item.actual))}`;
          printSafe(`${text(item?.name ?? item?.message ?? 'Criterion')}:${expected}${got}`);
        }
        if (result.data?.calls !== undefined) printSafe(`Calls: ${result.data.calls}`);
        if (result.data?.seconds !== undefined) printSafe(`Seconds: ${result.data.seconds}`);
        if (result.data?.problem ?? result.data?.whoseProblem) printSafe(`Problem: ${text(result.data.problem ?? result.data.whoseProblem)}`);
      }
      const link = resultLink(result.data); if (link.present && !link.value) { write(stderr, 'The runtime returned a link that is not a valid HTTPS URL.'); return 1; }
      if (link.value && !input.json) printSafe(link.value);
      return exitFor(result.data);
    }
    if (command === 'try') {
      const body = input.from === undefined ? {} : {from: input.from}; const result = await request('POST', '/v1/try', body);
      if (result.kind !== 'response') return result.code ?? 3;
      if (!printLinkOrRefuse(result.data, true)) return 1;
      if (!input.terminal) return exitFor({...result.data, verdict: result.data?.verdict ?? 'completed'});
      const token = text(result.data?.token) || (() => { try { return new URL(resultLink(result.data).value).pathname.split('/').filter(Boolean)[1] ?? ''; } catch { return ''; } })();
      if (!token) { write(stderr, 'The runtime did not return a terminal session.'); return 1; }
      const inputStream = input.input ?? ports.input ?? process.stdin;
      const rl = createInterface({input: inputStream, crlfDelay: Infinity});
      try {
        for await (const line of rl) {
          const commandResult = await request('POST', `/s/${encodeURIComponent(token)}/api/command`, {line});
          if (commandResult.kind !== 'response') return commandResult.code ?? 3;
          const data = commandResult.data ?? {};
          if (data.stdout !== undefined) printSafe(data.stdout); if (data.stderr !== undefined) write(stderr, text(data.stderr));
          if (data.exitCode !== undefined) printSafe(`exit code: ${data.exitCode}`);
          const callsLeft = data.callsLeft ?? data.calls_left ?? data.remainingCalls ?? data.callsRemaining ?? data.remaining;
          if (callsLeft !== undefined) printSafe(`calls left: ${callsLeft}`);
        }
      } finally { rl.close(); }
      return 0;
    }
    if (command === 'try-stop') {
      const result = await request('DELETE', `/v1/try/${encodeURIComponent(input.id)}`); if (result.kind !== 'response') return result.code ?? 3;
      printSafe(text(result.data?.message) || 'Try stopped.'); return exitFor({...result.data, verdict: result.data?.verdict ?? 'completed'});
    }
    if (command === 'replay') {
      const result = await request('POST', '/v1/replays', {id: input.id}); if (result.kind !== 'response') return result.code ?? 3;
      printSafe(`Replay: ${verdict(result.data) || 'completed'}.`); if (!printLinkOrRefuse(result.data, true)) return 1; return exitFor({...result.data, verdict: result.data?.verdict ?? 'completed'});
    }
    if (command === 'call') {
      let args; try { args = JSON.parse(input.json); } catch { write(stderr, 'The call JSON must be an object or array.'); return 2; }
      if (!args || typeof args !== 'object') { write(stderr, 'The call JSON must be an object or array.'); return 2; }
      const id = input.session ?? 'current'; const result = await request('POST', `/v1/try/${encodeURIComponent(id)}/call`, {prompt: input.prompt, op: input.op, args, ...(input.session ? {session: input.session} : {})});
      if (result.kind !== 'response') return result.code ?? 3; printSafe(JSON.stringify(safeValue(result.data))); return exitFor({...result.data, verdict: result.data?.verdict ?? 'completed'});
    }
    if (command === 'runs' || command === 'runs-show') {
      const result = await request('GET', command === 'runs' ? '/v1/runs' : `/v1/runs/${encodeURIComponent(input.id)}`); if (result.kind !== 'response') return result.code ?? 3;
      printSafe(JSON.stringify(safeValue(result.data))); return 0;
    }
    if (command === 'usage') {
      const result = await request('GET', '/v1/usage'); if (result.kind !== 'response') return result.code ?? 3; printSafe(JSON.stringify(safeValue(result.data))); return 0;
    }
    write(stderr, 'Unsupported runtime command.'); return 2;
  }
  return {execute};
}

export async function runRuntimeCommand(command, input = {}, ports = {}) {
  return createRuntimeClient(ports).execute(command, input);
}
