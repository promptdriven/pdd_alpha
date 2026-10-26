// Generated from prompts/cli/pdd-launch.prompt.md (sha256: b7b5e8195058e18c953f1ce23165ca7ec7213293c05c9981764aa046cf27db3c).
import * as fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { uptime, homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withUpdateLock, kernelLockHelper, validUpdateLease } from './update-lock.mjs';
import { readInstallRecord, writeInstallRecord, initialInstallRecord } from './install-record.mjs';
import { durableJson } from './install-record.mjs';
import { fileURLToPath } from 'node:url';
import { resolveRuntime } from './versions.mjs';
import { ensurePrivateDirectory, repairPrivateTree } from './pdd-directory.mjs';

const execFileAsync = promisify(execFile);
const fail = code => ({ code, next: 'Run ~/.pdd/launcher/pdd-launch recover; retain the install record for inspection.' });
const equal = (a, b) => a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
export async function localProcessProof(pid = process.pid) {
  if (process.platform !== 'linux') return null;
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z') return null;
    return { pid, birth: fields[19], bootId: (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() };
  } catch (e) { if (e.code === 'ENOENT' || e.code === 'ESRCH') return null; throw e; }
}
async function processState(proof, ports) {
  if (!proof) return 'unknown';
  if (ports.processState) return ports.processState(proof);
  try { return equal(await localProcessProof(proof.pid), proof) ? 'live' : 'dead'; } catch { return 'unknown'; }
}
export async function replaceInstallPointer({ home, name, runtime }, io = fs) {
  if (!['current', 'previous'].includes(name)) throw new Error('invalid pointer');
  const base = join(home, '.pdd'), temp = join(base, `.${name}-${randomUUID()}`);
  try {
    await io.symlink(runtime.versionRoot, temp);
    await io.rename(temp, join(base, name));
    const dir = await io.open(base, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  } finally { await io.unlink(temp).catch(() => {}); }
}
export async function armLinuxStartupDeadline({ home, attempt }, ports = {}) {
  if (process.platform !== 'linux') return fail('startup_deadline_unavailable');
  const unit = `pdd-start-${attempt.attemptId}`;
  try {
    const delay = Math.max(1, Math.ceil(attempt.deadlineAt - uptime() * 1000));
    await (ports.execFile ?? execFileAsync)('systemd-run', ['--user', '--collect', `--unit=${unit}`, `--setenv=HOME=${home}`, `--on-active=${delay}ms`, '--timer-property=AccuracySec=1ms', join(home, '.pdd/launcher/pdd-launch'), 'check-start', attempt.attemptId]);
    return { id: `${unit}.timer`, bootId: attempt.bootId, deadlineAt: attempt.deadlineAt };
  } catch { return fail('startup_deadline_unavailable'); }
}
async function readReady(home, ports) {
  if (ports.readReady) return ports.readReady();
  try { return JSON.parse(await fs.readFile(join(home, '.pdd/link/ready'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) return null; throw e; }
}
function matchingReady(ready, runtime, attempt) {
  return ready?.attemptId === attempt.attemptId && ready?.releaseId === runtime.releaseId && ready?.bootId === attempt.bootId && equal(ready.processProof, attempt.processProof) && Number.isFinite(ready.readyAt) && ready.readyAt >= attempt.startedAt && ready.readyAt < attempt.deadlineAt;
}
async function save(home, lease, record, next, ports) {
  return writeInstallRecord({ home, lease, expectedRev: record.rev, next }, ports);
}
async function rollback(home, lease, record, runtime, ports) {
  let fallback = null;
  try { fallback = await resolveRuntime({ home, versionRoot: join(home, '.pdd/previous') }, ports); }
  catch {}
  if (fallback?.releaseId === runtime.releaseId || (record.transaction?.phase === 'rolling_back' && record.transaction.from?.versionRoot !== fallback?.versionRoot)) return fail('recovery_required');
  const reportId = `startup-${runtime.releaseId}`;
  const next = structuredClone(record);
  next.rejected[runtime.releaseId] ??= { alphaDigest: runtime.alphaDigest, clientDigest: runtime.clientDigest, reason: 'three_failed_starts', transactionId: record.transaction?.id ?? reportId };
  if (!next.reports.some(r => r.id === reportId)) next.reports.push({ id: reportId, type: 'release.block', releaseId: runtime.releaseId, fallback: fallback?.releaseId ?? null, reason: 'three_failed_starts', delivered: false });
  next.transaction = { ...record.transaction, id: record.transaction?.id ?? reportId, phase: 'rolling_back', from: fallback, to: runtime, restartRequired: true, barrierId: record.transaction?.barrierId ?? null, manifestSeq: record.transaction?.manifestSeq ?? null, error: 'three_failed_starts' };
  let result = await save(home, lease, record, next, ports);
  if (result.code) return result;
  if (!fallback || result.value.rejected[fallback.releaseId]) return fail('recovery_required');
  let current;
  try { current = await resolveRuntime({ home }, ports); } catch { return fail('recovery_required'); }
  if (current.releaseId !== runtime.releaseId && current.releaseId !== fallback.releaseId) return fail('recovery_required');
  if (current.releaseId !== fallback.releaseId) await replaceInstallPointer({ home, name: 'current', runtime: fallback }, ports.fs);
  result = await save(home, lease, result.value, { transaction: { ...result.value.transaction, phase: 'rolled_back' } }, ports);
  return result.code ? result : { runtime: fallback, phase: 'rolled_back', code: null };
}
async function reconcileLocked({ home, lease, attemptId, deadline = false }, ports) {
  const read = await readInstallRecord({ home }, ports);
  if (read.code) return read;
  const record = read.value ?? initialInstallRecord();
  let runtime;
  try { runtime = await resolveRuntime({ home }, ports); } catch { return fail('runtime_unavailable'); }
  if (record.transaction?.phase === 'rolling_back') return rollback(home, lease, record, record.transaction.to, ports);
  const marker = await readReady(home, ports);
  if (attemptId) {
    // A CLI-only activation may leave Link on an older retained root. Its
    // registered deadline continues to name that exact start, not current.
    const target = Object.values(record.starts).find(s => s.pending?.attemptId === attemptId);
    if (target) runtime = target.runtime;
  } else {
    for (const [releaseId, other] of Object.entries(record.starts)) {
      if (releaseId === runtime.releaseId) continue;
      const proof = other.pending?.state === 'starting' ? other.pending.processProof : marker?.releaseId === releaseId && marker.attemptId === other.lastSuccess ? marker.processProof : null;
      if (proof) {
        const state = await processState(proof, ports);
        if (state === 'unknown') return fail('recovery_required');
        if (state === 'live') return { runtime, phase: 'ready', live: true, code: null };
      }
    }
  }
  const start = record.starts[runtime.releaseId], attempt = start?.pending;
  if (record.rejected[runtime.releaseId]) return fail('recovery_required');
  if (!attempt || attemptId && attempt.attemptId !== attemptId) {
    const live = start?.lastSuccess && marker?.attemptId === start.lastSuccess && marker?.releaseId === runtime.releaseId && await processState(marker.processProof, ports) === 'live';
    return { runtime, phase: 'ready', code: null, stale: Boolean(attemptId), live: Boolean(live) };
  }
  if (attempt.state === 'failed') {
    if (await processState(attempt.processProof, ports) !== 'dead') return fail('recovery_required');
    if (start.consecutiveFailures >= 3) return rollback(home, lease, record, runtime, ports);
    return { runtime, phase: 'failed', code: null };
  }
  if (!attempt.processProof || !attempt.deadlineRegistration) return fail('recovery_required');
  if (matchingReady(marker, runtime, attempt)) {
    const next = structuredClone(record);
    next.starts[runtime.releaseId] = { ...start, consecutiveFailures: 0, pending: null, lastSuccess: attempt.attemptId };
    const written = await save(home, lease, record, next, ports);
    if (written.code) return written;
    return { runtime, phase: 'ready', code: null, live: await processState(attempt.processProof, ports) === 'live' };
  }
  const status = await processState(attempt.processProof, ports);
  if (status === 'unknown') return fail('recovery_required');
  const now = ports.now ? await ports.now() : { bootId: (await localProcessProof())?.bootId, elapsedMs: uptime() * 1000 };
  const elapsed = now.bootId === attempt.bootId && now.elapsedMs >= attempt.deadlineAt;
  if (status === 'live' && !elapsed) return { runtime, phase: 'starting', live: true, code: null };
  const next = structuredClone(record);
  next.starts[runtime.releaseId] = { ...start, consecutiveFailures: start.consecutiveFailures + 1, pending: { ...attempt, state: 'failed' } };
  const written = await save(home, lease, record, next, ports);
  if (written.code) return written;
  if (status === 'live' && elapsed) {
    // Kernel pidfd termination on Linux prevents a reused pid from targeting a successor.
    const terminate = ports.terminateProcess ?? (async proof => {
      await execFileAsync(kernelLockHelper, ['--terminate', String(proof.pid), String(proof.birth)]);
    });
    if (await processState(attempt.processProof, ports) === 'live') {
      try { await terminate(attempt.processProof); } catch { return fail('recovery_required'); }
    }
  }
  if (next.starts[runtime.releaseId].consecutiveFailures >= 3) return rollback(home, lease, written.value, runtime, ports);
  return { runtime, phase: 'failed', code: null, deadline };
}
export async function reconcileStartup({ home, attemptId, deadline = false }, ports = {}) {
  try { return await (ports.withUpdateLock ?? withUpdateLock)({ home }, lease => reconcileLocked({ home, lease, attemptId, deadline }, ports), ports); }
  catch { return fail('recovery_required'); }
}
export async function prepareLinkStart({ home }, ports = {}) {
  if (!ports.armStartupDeadline && process.platform !== 'linux') return fail('startup_deadline_unavailable');
  return (ports.withUpdateLock ?? withUpdateLock)({ home }, async lease => {
    const previous = await reconcileLocked({ home, lease }, ports);
    if (previous.code || previous.live) return previous;
    const runtime = previous.runtime;
    if (!runtime.clientDigest) return fail('client_not_installed');
    const read = await readInstallRecord({ home }, ports);
    if (read.code) return read;
    const record = read.value ?? initialInstallRecord();
    const proof = ports.selfProof ? await ports.selfProof() : await localProcessProof();
    if (!proof) return fail('recovery_required');
    const now = ports.now ? await ports.now() : { bootId: proof.bootId, elapsedMs: uptime() * 1000 };
    const attempt = { attemptId: randomUUID(), bootId: now.bootId, processProof: proof, startedAt: now.elapsedMs, deadlineAt: now.elapsedMs + 600000, deadlineRegistration: null, state: 'starting' };
    const old = record.starts[runtime.releaseId] ?? { runtime, consecutiveFailures: 0, pending: null, lastSuccess: null };
    let written = await save(home, lease, record, { starts: { [runtime.releaseId]: { ...old, pending: attempt } } }, ports);
    if (written.code) return written;
    try {
      await (ports.clearReady ?? (() => fs.rm(join(home, '.pdd/link/ready'), { force: true })))();
      const registration = await (ports.armStartupDeadline ?? (attempt => armLinuxStartupDeadline({ home, attempt }, ports)))(attempt);
      if (!registration || registration.code) return fail('startup_deadline_unavailable');
      attempt.deadlineRegistration = registration;
      written = await save(home, lease, written.value, { starts: { [runtime.releaseId]: { ...old, pending: attempt } } }, ports);
      return written.code ? written : { runtime, attempt, phase: 'starting', code: null };
    } catch { return fail('startup_deadline_unavailable'); }
  }, ports);
}
export async function recordExecFailure({ home, attemptId }, ports = {}) {
  return (ports.withUpdateLock ?? withUpdateLock)({ home }, async lease => {
    const read = await readInstallRecord({ home }, ports); if (read.code || !read.value) return read;
    const record = read.value, entry = Object.entries(record.starts).find(([, s]) => s.pending?.attemptId === attemptId);
    if (!entry || entry[1].pending.state === 'failed') return { code: null };
    const [id, start] = entry;
    const result = await save(home, lease, record, { starts: { [id]: { ...start, consecutiveFailures: start.consecutiveFailures + 1, pending: { ...start.pending, state: 'failed' } } } }, ports);
    if (result.code) return result;
    return start.consecutiveFailures + 1 >= 3 ? rollback(home, lease, result.value, start.runtime, ports) : { phase: 'failed', code: null };
  }, ports);
}
export async function commitStartupReady({ home, attemptId }, ports = {}) {
  return (ports.withUpdateLock ?? withUpdateLock)({ home }, async lease => {
    const read = await readInstallRecord({ home }, ports); if (read.code || !read.value) return read;
    const record = read.value;
    const entry = Object.entries(record.starts).find(([, s]) => s.pending?.attemptId === attemptId);
    if (!entry || entry[1].pending.state !== 'starting') return fail('recovery_required');
    const [releaseId, start] = entry, attempt = start.pending;
    const proof = ports.selfProof ? await ports.selfProof() : await localProcessProof();
    const now = ports.now ? await ports.now() : { bootId: proof?.bootId, elapsedMs: uptime() * 1000 };
    if (!equal(proof, attempt.processProof) || now.bootId !== attempt.bootId || now.elapsedMs < attempt.startedAt || now.elapsedMs >= attempt.deadlineAt) return fail('recovery_required');
    await durableJson(join(home, '.pdd/link/ready'), { attemptId, releaseId, bootId: now.bootId, processProof: proof, readyAt: now.elapsedMs }, ports.fs);
    const result = await save(home, lease, record, { starts: { [releaseId]: { ...start, consecutiveFailures: 0, pending: null, lastSuccess: attemptId } } }, ports);
    return { code: result.code };
  }, ports);
}
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
async function writeEqual(path, text, mode = 0o600, privatePdd = false) {
  try { if (await fs.readFile(path, 'utf8') === text) return false; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (privatePdd) await ensurePrivateDirectory(dirname(path));
  else await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, text, { mode, flag: 'wx' }); await fs.rename(temp, path); }
  finally { await fs.rm(temp, { force: true }); }
  return true;
}
export async function installLauncherSupport({ home, runtime, lease }, ports = {}) {
  if (!validUpdateLease(lease, home)) return fail('lock_unavailable');
  try {
    await resolveRuntime({ home, versionRoot: runtime.versionRoot }, ports);
    const base = join(home, '.pdd/launcher'), support = join(base, `support-${runtime.releaseId}`);
    await ensurePrivateDirectory(base);
    try { await fs.lstat(support); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const temporary = join(base, `.support-${randomUUID()}`);
      await ensurePrivateDirectory(join(temporary, 'src'));
      await ensurePrivateDirectory(join(temporary, 'launcher'));
      for (const name of ['pdd-launch', 'detached-updater', 'update-lock', 'install-record', 'owned-node', 'versions', 'pdd-directory']) await fs.copyFile(join(runtime.versionRoot, 'src', `${name}.mjs`), join(temporary, 'src', `${name}.mjs`));
      for (const name of ['support-entry.mjs', 'link-entry.mjs', 'update-entry.mjs']) await fs.copyFile(join(runtime.versionRoot, 'launcher', name), join(temporary, 'launcher', name));
      await fs.cp(join(runtime.versionRoot, 'launcher/native'), join(temporary, 'launcher/native'), { recursive: true, errorOnExist: true });
      await fs.symlink(runtime.node, join(temporary, 'node'));
      await durableJson(join(temporary, 'runtime.json'), runtime);
      await repairPrivateTree(temporary);
      await fs.rename(temporary, support);
    }
    // Keep a complete known-working support version; do not replace support on
    // routine candidate activation. Explicit setup provisions it only when absent.
    try { await fs.lstat(join(base, 'support')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; await fs.symlink(support, join(base, 'support')); }
    const source = await fs.readFile(join(runtime.versionRoot, 'launcher/pdd-launch'), 'utf8');
    await writeEqual(join(base, 'pdd-launch'), source, 0o755, true);
    const shim = `#!/bin/sh\nexec ${shellQuote(join(base, 'pdd-launch'))} cli "$@"\n`;
    await writeEqual(join(home, '.pdd/bin/pdd'), shim, 0o755, true);
    return { code: null, support };
  } catch { return fail('runtime_unavailable'); }
}
export function recoveryServiceFiles({ home, platform = process.platform }) {
  const launcher = join(home, '.pdd/launcher/pdd-launch');
  if (platform === 'linux') {
    const quote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
    return [{ path: join(home, '.config/systemd/user/pdd-runs-keeper.service'), text: `[Unit]\nDescription=PDD workflow recovery\nStartLimitIntervalSec=0\n\n[Service]\nExecStart=${quote(launcher)} cli runs-keeper\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n` }];
  }
  if (platform === 'darwin') {
    const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    return [{ path: join(home, 'Library/LaunchAgents/ai.promptdriven.pdd-runs-keeper.plist'), text: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>ai.promptdriven.pdd-runs-keeper</string><key>ProgramArguments</key><array><string>${xml(launcher)}</string><string>cli</string><string>runs-keeper</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>AbandonProcessGroup</key><true/></dict></plist>\n` }];
  }
  return [];
}
export async function provisionRecoveryService({ home, runtime, lease }, ports = {}) {
  if (!validUpdateLease(lease, home)) return fail('lock_unavailable');
  try {
    const files = recoveryServiceFiles({ home, platform: ports.platform });
    if (!files.length) return fail('unsupported_runtime');
    let changed = false;
    for (const file of files) changed = await writeEqual(file.path, file.text) || changed;
    if (ports.activateRecoveryService) await ports.activateRecoveryService({ files, changed });
    else if ((ports.platform ?? process.platform) === 'linux') {
      if (changed) await execFileAsync('systemctl', ['--user', 'daemon-reload']);
      await execFileAsync('systemctl', ['--user', 'enable', '--now', 'pdd-runs-keeper.service']);
    } else {
      const execute = ports.execFile ?? execFileAsync;
      const service = `gui/${process.getuid()}/ai.promptdriven.pdd-runs-keeper`;
      // Equal text proves only the file, not a previously failed activation.
      let loaded = false;
      try { await execute('launchctl', ['print', service]); loaded = true; } catch {}
      if (loaded && changed) { await execute('launchctl', ['bootout', service]); loaded = false; }
      if (!loaded) await execute('launchctl', ['bootstrap', `gui/${process.getuid()}`, files[0].path]);
      await execute('launchctl', ['print', service]);
    }
    return { code: null, changed, files: files.map(f => f.path) };
  } catch { return fail('service_unavailable'); }
}
export async function runLauncherCommand(argv, ports = {}) {
  const home = ports.home ?? homedir(), mode = argv[0];
  if (!['link', 'cli', 'recover', 'check-start'].includes(mode) || mode === 'check-start' && !/^[a-zA-Z0-9-]+$/.test(argv[1] ?? '')) return { code: 'usage' };
  if (mode === 'check-start') return reconcileStartup({ home, attemptId: argv[1], deadline: true }, ports);
  // Installed transaction recovery never imports mutable current code.
  const { recoverUpdate } = await import('./detached-updater.mjs');
  const recovered = await recoverUpdate({ home }, ports);
  if (recovered.code) return recovered;
  if (mode === 'recover') return reconcileStartup({ home }, ports);
  if (mode === 'cli') {
    const result = await reconcileStartup({ home }, ports);
    if (result.code) return result;
    const exec = ports.exec ?? ((file, args, env) => process.execve(file, args, env));
    return exec(result.runtime.node, [result.runtime.node, result.runtime.bin, ...argv.slice(1)], process.env);
  }
  const result = await prepareLinkStart({ home }, ports);
  if (result.code || result.live) return result;
  const link = fileURLToPath(new URL('../launcher/link-entry.mjs', import.meta.url));
  try {
    await fs.access(link);
    return (ports.exec ?? ((file, args, env) => process.execve(file, args, env)))(result.runtime.node, [result.runtime.node, link, result.runtime.versionRoot], { ...process.env, PDD_START_ATTEMPT: result.attempt.attemptId });
  } catch {
    await recordExecFailure({ home, attemptId: result.attempt.attemptId }, ports);
    return fail('runtime_unavailable');
  }
}
