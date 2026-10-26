import {execFileSync, spawnSync} from 'node:child_process';
import {createHash, randomUUID as systemUUID} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createInterface} from 'node:readline';

const TIMEOUT = 30_000;
const UNKNOWN = 'The run may have executed. Its result is unknown. Read this request; do not resubmit.';
const STATES = new Set(['queued', 'running', 'passed', 'failed', 'refused', 'unknown']);
const HIDDEN = /token|secret|password|authorization|credential|private.?key/i;
const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
const write = (stream, value) => stream.write(`${value}\n`);
const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const state = data => STATES.has(data?.state) ? data.state : null;
const exitFor = value => value === 'passed' ? 0 : ['failed', 'refused'].includes(value) ? 1 : 3;
const recovery = (command, id) => `pdd ${command} --request '${id}'`;

function configuredOrigin(env) {
  const raw = clean(env?.PDD_RUNTIME_URL).trim();
  if (!raw) return {error: 'The runtime service is not configured yet.'};
  try {
    const url = new URL(raw);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)
      || url.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return {error: 'The runtime service URL must use HTTPS.'};
    url.pathname = url.pathname.replace(/\/+$/, '');
    return {url};
  } catch { return {error: 'The runtime service URL is invalid.'}; }
}
async function getToken(ports) {
  try {
    if (typeof ports.getGithubToken === 'function') return clean(await ports.getGithubToken()).trim();
    if (ports.githubToken !== undefined) return clean(ports.githubToken).trim();
    if (ports.authToken !== undefined) return clean(ports.authToken).trim();
    return clean((ports.execFileSync ?? execFileSync)('gh', ['auth', 'token'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})).trim();
  } catch { return ''; }
}
function safe(value, depth = 0) {
  if (depth > 6 || value === null || ['string', 'number', 'boolean'].includes(typeof value)) return typeof value === 'string' ? clean(value).slice(0, 8000) : value;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => safe(item, depth + 1));
  if (typeof value === 'object') { const result = {}; for (const [key, item] of Object.entries(value)) if (!HIDDEN.test(key)) result[clean(key)] = safe(item, depth + 1); return result; }
  return undefined;
}
function validLink(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function qr(value) {
  const size = 21, cells = Array.from({length: size}, () => Array(size).fill(false));
  const finder = (ox, oy) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) cells[oy + y][ox + x] = x === 0 || x === 6 || y === 0 || y === 6 || x >= 2 && x <= 4 && y >= 2 && y <= 4; };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7); let seed = 2166136261;
  for (const character of value) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!cells[y][x] && !(x < 8 && y < 8) && !(x >= size - 8 && y < 8) && !(x < 8 && y >= size - 8)) { seed = Math.imul(seed ^ (x * 31 + y), 16777619) >>> 0; cells[y][x] = !!(seed & 1); }
  return cells.map(row => row.map(on => on ? '██' : '  ').join('')).join('\n');
}
function sourceFiles(repo) {
  const result = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], {cwd: repo, encoding: null, maxBuffer: 64 * 1024 * 1024});
  if (result.status !== 0) throw Error('source capture failed');
  const names = [...new Set(result.stdout.toString('utf8').split('\0').filter(Boolean))].sort();
  const files = [];
  for (const name of names) { if (name.startsWith('/') || name.split('/').includes('..') || name.split('/').includes('.git')) throw Error('invalid source path'); const stat = lstatSync(join(repo, name)); if (stat.isSymbolicLink() || stat.isBlockDevice() || stat.isCharacterDevice() || stat.isFIFO() || stat.isSocket()) throw Error('source must contain regular files only'); if (stat.isFile()) { if (stat.nlink !== 1) throw Error('source must contain regular files only'); files.push(name); } }
  return files;
}
function packSource(repo) {
  const names = sourceFiles(repo), digests = new Map(names.map(name => [name, createHash('sha256').update(readFileSync(join(repo, name))).digest('hex')]));
  const directory = mkdtempSync(join(tmpdir(), 'pdd-runtime-')), archive = join(directory, 'source.tar');
  try {
    const result = spawnSync('tar', ['--null', '--no-recursion', '-T', '-', '-cf', archive], {cwd: repo, input: Buffer.from(names.map(name => `./${name}\0`).join(''))});
    if (result.status !== 0) throw Error('source capture failed');
    const after = sourceFiles(repo); if (JSON.stringify(names) !== JSON.stringify(after)) throw Error('source changed while packing');
    for (const name of names) if (createHash('sha256').update(readFileSync(join(repo, name))).digest('hex') !== digests.get(name)) throw Error('source changed while packing');
    const bytes = readFileSync(archive); if (bytes.length > 10_485_760) throw Error('source-too-large');
    const packed = {bytes, sha256: createHash('sha256').update(bytes).digest('hex'), names}; rmSync(directory, {recursive: true, force: true}); return packed;
  } catch (error) { rmSync(directory, {recursive: true, force: true}); throw error; }
}
const multipart = (request, bytes) => { const form = new FormData(); form.set('request', new Blob([JSON.stringify(request)], {type: 'application/json'}), 'request.json'); form.set('source', new Blob([bytes], {type: 'application/x-tar'}), 'source.tar'); return form; };

export function createRuntimeClient(ports = {}) {
  const stdout = ports.stdout ?? process.stdout, stderr = ports.stderr ?? process.stderr, env = ports.env ?? process.env;
  const cwd = ports.cwd ?? process.cwd(), uuid = ports.randomUUID ?? systemUUID, fetchImpl = ports.fetch ?? globalThis.fetch, timeout = ports.timeoutMs ?? TIMEOUT;
  let lastData = null;
  async function request(method, path, body, headers = {}) {
    const origin = configuredOrigin(env); if (origin.error) { write(stderr, origin.error); return {kind: 'config', code: 1}; }
    const auth = await getToken(ports); if (!auth) { write(stderr, 'Sign in to GitHub first: gh auth login'); return {kind: 'auth', code: 1}; }
    if (typeof fetchImpl !== 'function') { write(stderr, UNKNOWN); return {kind: 'unknown', code: 3}; }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(new URL(path, `${origin.url.href}/`), {method, headers: {Authorization: `Bearer ${auth}`, ...headers}, ...(body === undefined ? {} : {body}), signal: controller.signal});
      let data = null; try { data = await response.json(); } catch {}
      const ok = response.ok ?? (response.status >= 200 && response.status < 300);
      if (!ok) { if (data?.error?.message) write(stderr, clean(data.error.message)); const ambiguous = response.status >= 500 || response.status === 408 || response.status === 429 || response.status === 503; return {kind: ambiguous ? 'unknown' : 'response', data, code: ambiguous ? 3 : 1}; }
      return {kind: 'response', data};
    } catch { write(stderr, UNKNOWN); return {kind: 'unknown', code: 3}; } finally { clearTimeout(timer); }
  }
  async function ready() {
    const configured = configuredOrigin(env); if (configured.error) { write(stderr, configured.error); return false; }
    if (!(await getToken(ports))) { write(stderr, 'Sign in to GitHub first: gh auth login'); return false; }
    return true;
  }
  function render(command, data, jsonOutput = false) {
    const current = state(data); if (!current) return 3;
    if (current === 'unknown') { write(stdout, UNKNOWN); return 3; }
    if (jsonOutput) { write(stdout, JSON.stringify(safe(data))); return exitFor(current); }
    if (command === 'check') { write(stdout, `Check: ${data.result?.outcome ?? current}.`); if (data.result?.who) write(stdout, `Who: ${clean(data.result.who)}`); if (data.result?.why) write(stdout, clean(data.result.why)); if (data.result?.next_step) write(stdout, clean(data.result.next_step)); for (const refusal of data.result?.refusals ?? []) write(stdout, `${clean(refusal.message ?? 'Runtime refusal')} (${clean(refusal.code ?? 'unknown')})`); if (data.report_url) write(stdout, validLink(data.report_url) ?? ''); }
    else if (command === 'lint') write(stdout, `Lint: ${current}.`);
    else if (command === 'try') { const url = validLink(data.result?.url), configured = configuredOrigin(env); let trusted = false; try { trusted = !!url && !!configured.url && new URL(url).origin === configured.url.origin; } catch {} if (!trusted) { write(stderr, 'The runtime returned a link that is not a valid HTTPS URL.'); return 3; } write(stdout, url); write(stdout, 'QR:'); write(stdout, qr(url)); }
    else if (command === 'replay') { write(stdout, `Replay: ${current}.`); if (data.report_url) { const report = validLink(data.report_url); if (!report) { write(stderr, 'The runtime returned a link that is not a valid HTTPS URL.'); return 3; } write(stdout, report); } }
    else if (command === 'stop') write(stdout, clean(data.result?.output ?? 'Try stopped.'));
    else if (command === 'call') write(stdout, JSON.stringify(safe(data.result?.output ?? data.result ?? data)));
    else write(stdout, JSON.stringify(safe(data)));
    return exitFor(current);
  }
  async function recover(command, id, display = command) {
    if (!validId(id)) { write(stderr, 'The request id is invalid.'); return 2; }
    write(stderr, recovery(display, id)); const result = await request('GET', `/v1/runs/${encodeURIComponent(id)}`);
    const data = result.data; if (result.kind !== 'response' || !data || data.requestId !== id || data.id !== id || data.command !== command || !state(data)) { if (result.kind === 'response' && !data?.error) write(stderr, UNKNOWN); return result.code ?? 3; }
    return render(command, data);
  }
  async function submit(command, path, requestBody, bytes, source = true, jsonOutput = false) {
    const id = requestBody.requestId; write(stderr, recovery(command, id));
    const result = await request('POST', path, source ? multipart(requestBody, bytes) : JSON.stringify(requestBody), source ? {} : {'Content-Type': 'application/json'});
    if (result.kind !== 'response') return result.code ?? 3; let data = result.data;
    if (!data || data.requestId !== id || data.id !== id || data.command !== command || !state(data)) { write(stderr, UNKNOWN); return 3; }
    if (['queued', 'running'].includes(data.state)) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { await new Promise(resolveWait => setTimeout(resolveWait, 250)); const polled = await request('GET', `/v1/runs/${id}`); if (polled.kind !== 'response') return 3; data = polled.data; if (!data || data.requestId !== id || data.id !== id || data.command !== command || !state(data)) { write(stderr, UNKNOWN); return 3; } if (!['queued', 'running'].includes(data.state)) break; } if (['queued', 'running'].includes(data.state)) { write(stderr, UNKNOWN); return 3; } }
    lastData = data;
    return render(command, data, jsonOutput);
  }
  async function execute(command, input = {}) {
    if (input.request) return recover(command === 'try-stop' ? 'stop' : command, input.request, command === 'try-stop' ? 'try stop' : command);
    if (!(await ready())) return 1;
    if (command === 'runs' || command === 'runs-show' || command === 'usage') { const query = input.query ? `?${new URLSearchParams(input.query).toString()}` : ''; const result = await request('GET', command === 'runs' ? `/v1/runs${query}` : `/v1/runs/${encodeURIComponent(input.id)}`); if (result.kind !== 'response') return result.code ?? 3; write(stdout, JSON.stringify(safe(result.data))); return 0; }
    const candidate = uuid(), id = validId(candidate) ? candidate : systemUUID();
    try {
      if (['lint', 'check', 'try'].includes(command)) { if (command === 'try' && input.from) return submit('try', '/v1/try', {requestId: id, from: input.from, ...(input.maxCalls !== undefined ? {max_calls: Number(input.maxCalls)} : {}), ...(input.tab ? {tab: input.tab} : {})}, undefined, false); const packed = packSource(resolve(cwd)), body = {requestId: id, source_sha256: packed.sha256}; if (command === 'lint' && input.path !== undefined) body.paths = [input.path]; if (command === 'check') { body.scenario = input.scenario; if (!body.scenario) { write(stderr, 'A scenario file is required.'); return 2; } if (!packed.names.includes(body.scenario)) { write(stderr, 'A requested file is missing from the upload.'); return 1; } if (input.maxCalls !== undefined) { body.max_calls = Number(input.maxCalls); if (!Number.isInteger(body.max_calls) || body.max_calls < 1 || body.max_calls > 100) { write(stderr, 'The requested call limit is outside the allowed range.'); return 2; } } if (input.resourceMode) body.resource_mode = input.resourceMode; if (input.project) body.project = input.project; } if (command === 'try') { body.seed = input.seed ?? 'seed.json'; if (input.seed && !packed.names.includes(input.seed)) { write(stderr, 'A requested file is missing from the upload.'); return 1; } if (input.appMap) { body.app_map = input.appMap; if (!packed.names.includes(input.appMap)) { write(stderr, 'A requested file is missing from the upload.'); return 1; } } if (input.maxCalls !== undefined) { body.max_calls = Number(input.maxCalls); if (!Number.isInteger(body.max_calls) || body.max_calls < 0 || body.max_calls > 100) { write(stderr, 'The requested call limit is outside the allowed range.'); return 2; } } body.tab = input.tab ?? (input.terminal ? 'terminal' : 'screen'); } const result = await submit(command, command === 'lint' ? '/v1/lint' : command === 'check' ? '/v1/check' : '/v1/try', body, packed.bytes, true, !!input.json); if (command === 'try' && input.terminal && result === 0 && lastData?.result?.session?.id) { const inputStream = input.input ?? ports.input ?? process.stdin, readline = createInterface({input: inputStream, crlfDelay: Infinity}); try { for await (const line of readline) { const actionCandidate = uuid(), actionId = validId(actionCandidate) ? actionCandidate : systemUUID(); write(stderr, recovery('call', actionId)); const action = await request('POST', `/v1/try/${encodeURIComponent(lastData.result.session.id)}/call`, JSON.stringify({requestId: actionId, prompt: 'runCli', operation: 'runCli', input: {argv: [line]}}), {'Content-Type': 'application/json'}); if (action.kind !== 'response' || !action.data || action.data.requestId !== actionId || action.data.id !== actionId || action.data.command !== 'call' || !state(action.data)) { write(stderr, UNKNOWN); return 3; } const actionResult = action.data.result ?? {}; if (actionResult.output?.stdout !== undefined) write(stdout, clean(actionResult.output.stdout)); if (actionResult.output?.stderr !== undefined) write(stderr, clean(actionResult.output.stderr)); if (actionResult.exitCode !== undefined) write(stdout, `exit code: ${actionResult.exitCode}`); if (actionResult.report?.remaining_calls !== undefined) write(stdout, `calls left: ${actionResult.report.remaining_calls}`); if (action.data.state === 'failed' || action.data.state === 'refused') return 1; if (action.data.state === 'unknown') return 3; } } finally { readline.close(); } } return result; }
      if (command === 'replay') return submit('replay', '/v1/replay', {requestId: id, from: input.from ?? input.id}, undefined, false);
      if (command === 'call') { if (!input.session) { write(stderr, 'A Try session is required for hosted call.'); return 2; } let value; try { value = JSON.parse(input.json); } catch { write(stderr, 'The call JSON must be valid JSON.'); return 2; } return submit('call', `/v1/try/${encodeURIComponent(input.session)}/call`, {requestId: id, prompt: input.prompt, operation: input.op, input: value}, undefined, false); }
      if (command === 'try-stop') { if (!input.id) { write(stderr, 'A Try id is required.'); return 2; } write(stderr, recovery('try stop', id)); const result = await request('DELETE', `/v1/try/${encodeURIComponent(input.id)}`, undefined, {'X-Request-Id': id}); if (result.kind !== 'response') return result.code ?? 3; let data = result.data; if (!data || data.requestId !== id || data.id !== id || data.command !== 'stop' || !state(data)) { write(stderr, UNKNOWN); return 3; } if (['queued', 'running'].includes(data.state)) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { await new Promise(resolveWait => setTimeout(resolveWait, 250)); const polled = await request('GET', `/v1/runs/${id}`); if (polled.kind !== 'response') return 3; data = polled.data; if (!data || data.requestId !== id || data.id !== id || data.command !== 'stop' || !state(data)) { write(stderr, UNKNOWN); return 3; } if (!['queued', 'running'].includes(data.state)) break; } } return render('stop', data); }
    } catch (error) { write(stderr, error?.message === 'source-too-large' ? 'The source upload exceeds the server size limit.' : 'The source could not be captured before submission.'); return 1; }
    write(stderr, 'Unsupported runtime command.'); return 2;
  }
  return {execute};
}
export async function runRuntimeCommand(command, input = {}, ports = {}) { return createRuntimeClient(ports).execute(command, input); }
