// Generated from prompts/cli/bootstrap.prompt.md (sha256: d198a03e4fa35a1aa37c81f1fc660e09baca624a604ce12c0ac2625a2021e069).
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runUpdate, recoverUpdate } from '../src/detached-updater.mjs';
import { directoryDigest } from '../src/owned-node.mjs';
import { resolveRuntime } from '../src/versions.mjs';
import { durableJson, readInstallRecord, writeInstallRecord, initialInstallRecord } from '../src/install-record.mjs';
import { withUpdateLock } from '../src/update-lock.mjs';
import { installLauncherSupport, provisionRecoveryService, localProcessProof } from '../src/pdd-launch.mjs';

const execute = promisify(execFile);
const macStartTime = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/;
async function bootstrapProcessProof(pid = process.pid, options = {}) {
  if (process.platform !== 'darwin') return localProcessProof(pid);
  const run = options.bootstrapExecFile ?? execute;
  const config = { encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } };
  try {
    const boot = (await run('/usr/sbin/sysctl', ['-n', 'kern.boottime'], config)).stdout;
    const match = /^\{\s*sec\s*=\s*(\d+),\s*usec\s*=\s*(\d+)\s*\}/.exec(boot.trim());
    if (!match) throw new Error('unreadable boot identity');
    const birth = (await run('/bin/ps', ['-p', String(pid), '-o', 'lstart='], config)).stdout.trim().replace(/\s+/g, ' ');
    if (!macStartTime.test(birth)) throw new Error('unreadable process identity');
    // lstart has second precision: a collision must refuse takeover, not guess.
    return { pid, birth: `darwin-lstart:${birth}`, bootId: `darwin-boottime:${match[1]}:${match[2]}` };
  } catch {
    // Tool failure, permissions and a stopped process do not prove death.
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return null; }
    throw new Error('recovery_required');
  }
}

// This entry is reached only after the verified shell has checked and extracted
// its pinned artifacts. A newer installer cannot replace a saved install target.
export async function completeBootstrap({ home, stage }, options = {}) {
  if (!stage.startsWith(`${home}/.pdd/update/staging/bootstrap-`) || await fs.realpath(stage) !== stage) throw new Error('verification_error');
  const descriptor = JSON.parse(await fs.readFile(join(stage, 'release.json'), 'utf8'));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(descriptor.releaseId ?? '')) throw new Error('verification_error');
  const nodeDescriptor = descriptor.nodes[`${process.platform}-${process.arch}`];
  for (const [name, artifact] of [['node', nodeDescriptor], ['alpha', descriptor.alpha]]) {
    const bytes = await fs.readFile(join(stage, `${name}.tar.gz`));
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256 || !artifact.provenance) throw new Error('verification_error');
  }
  const versionRoot = join(home, '.pdd/versions', descriptor.releaseId);
  const runtime = { v: 1, releaseId: descriptor.releaseId, versionRoot, node: join(home, '.pdd/tools/node', nodeDescriptor.version, 'bin/node'), bin: join(versionRoot, 'bin/pdd.mjs'), pddVersion: descriptor.pddVersion, alphaDigest: descriptor.alpha.integrity, clientDigest: null, nodeVersion: nodeDescriptor.version, credentialHelper: null };
  const treeDigest = await directoryDigest(join(stage, 'node'));
  await durableJson(join(stage, 'node/.pdd-node.json'), { artifactIdentity: nodeDescriptor.sha256, treeDigest, nodeVersion: nodeDescriptor.version, platform: process.platform, arch: process.arch });
  const stagedNode = join(stage, 'node/bin/node');
  const candidate = { alphaRoot: join(stage, 'alpha'), temporaryNode: stagedNode, temporaryBin: join(stage, 'alpha/bin/pdd.mjs'), nodeStage: { stagedNode, nodeVersion: nodeDescriptor.version, artifactIdentity: nodeDescriptor.sha256 }, runtime };
  const target = { releaseId: descriptor.releaseId, manifestSeq: descriptor.manifestSeq ?? 0, artifacts: { alpha: descriptor.alpha, node: nodeDescriptor }, runtime, authorization: { bootstrap: descriptor.alpha.sha256 } };
  let id, recovering = false;
  const ports = {
    ...options, home,
    authorizeTarget: proposed => JSON.stringify(proposed) === JSON.stringify(target),
    stageArtifacts: async () => candidate,
    listRetainedRuntimes: async () => ({ complete: true, runtimes: [] }),
    checkCompatibility: async () => {
      try { await fs.lstat(join(home, '.pdd/current')); return false; } catch (e) { return e.code === 'ENOENT'; }
    },
    acquireActivationBarrier: async transactionId => ({ id: `fresh-${transactionId}`, held: true, durable: true, drained: true }),
    recoverActivationBarrier: async barrierId => barrierId === `fresh-${id}` ? { id: barrierId, held: true, durable: true, drained: true } : null
  };
  const registered = await withUpdateLock({ home }, async lease => {
    const read = await readInstallRecord({ home });
    if (read.code) return read;
    const proof = await bootstrapProcessProof(process.pid, options);
    if (process.platform === 'darwin' && !proof) return { code: 'recovery_required' };
    const record = read.value ?? initialInstallRecord();
    if (read.value) {
      const jobs = Object.entries(record.staging);
      if (jobs.length !== 1) return { code: 'recovery_required' };
      const [savedId, job] = jobs[0]; id = savedId;
      if (job.requestId !== `bootstrap-${descriptor.releaseId}` || JSON.stringify(job.target) !== JSON.stringify(target) || record.rejected[descriptor.releaseId]) return { code: 'recovery_required' };
      const tx = record.transaction;
      if (tx && (tx.id !== id || tx.from !== null || JSON.stringify(tx.to) !== JSON.stringify(runtime) || !['activating', 'flipped', 'ready'].includes(tx.phase))) return { code: 'recovery_required' };
      // A missing or unprovable owner is not permission to duplicate an install.
      if (tx?.phase !== 'ready') {
        if (!job.processProof || !Number.isSafeInteger(job.processProof.pid) || job.processProof.pid <= 1 || typeof job.processProof.birth !== 'string' || typeof job.processProof.bootId !== 'string' || !['linux', 'darwin'].includes(process.platform)) return { code: 'recovery_required' };
        if (process.platform === 'darwin' && (!job.processProof.birth.startsWith('darwin-lstart:') || !macStartTime.test(job.processProof.birth.slice('darwin-lstart:'.length)) || !/^darwin-boottime:\d+:\d+$/.test(job.processProof.bootId))) return { code: 'recovery_required' };
        const live = await bootstrapProcessProof(job.processProof.pid, options);
        if (live && JSON.stringify(live) === JSON.stringify(job.processProof)) return { code: 'bootstrap_busy' };
      }
      if (tx) recovering = true;
      else {
        try { await fs.lstat(join(home, '.pdd/current')); return { code: 'recovery_required' }; }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      return writeInstallRecord({ home, lease, expectedRev: record.rev, next: { staging: { [id]: { ...job, paths: [...new Set([...job.paths, stage])], processProof: proof, ...(!tx ? { phase: 'downloading', candidate: null, checkedAt: null } : {}) } } } });
    }
    try { await fs.lstat(join(home, '.pdd/current')); return { code: 'recovery_required' }; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    id = randomUUID();
    return writeInstallRecord({ home, lease, expectedRev: 0, next: { ...record, staging: { [id]: { requestId: `bootstrap-${descriptor.releaseId}`, target, paths: [stage], phase: 'downloading', processProof: proof } } } });
  });
  if (registered.code) throw new Error(registered.code);
  const installed = recovering ? await recoverUpdate({ home }, ports) : await runUpdate({ transactionId: id }, ports);
  if (installed.code || installed.phase !== 'ready') throw new Error(installed.code ?? 'recovery_required');
  const selected = await resolveRuntime({ home });
  if (JSON.stringify(selected) !== JSON.stringify(runtime)) throw new Error('recovery_required');
  const support = await withUpdateLock({ home }, async lease => {
    const prepared = await installLauncherSupport({ home, runtime, lease }, options);
    if (prepared.code) return prepared;
    return provisionRecoveryService({ home, runtime, lease }, options);
  });
  if (support.code) throw new Error(support.code);
  return { runtime, transactionId: id };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [home, stage, ...args] = process.argv.slice(2);
  try {
    const { runtime } = await completeBootstrap({ home, stage });
    process.stdout.write('Continue with pdd setup\n');
    process.execve(runtime.node, [runtime.node, runtime.bin, 'setup', ...args], process.env);
  } catch (e) {
    process.stderr.write(`${/^[a-z_]+$/.test(e.message) ? e.message : 'verification_error'}: Obtain the matching verified release installer and rerun pdd setup.\n`);
    process.exitCode = 1;
  }
}
