import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withUpdateLock } from '../../src/update-lock.mjs';
import { initialInstallRecord, writeInstallRecord, readInstallRecord } from '../../src/install-record.mjs';
export const repo = fileURLToPath(new URL('../../', import.meta.url));
export async function cases(name) { return JSON.parse(await fs.readFile(new URL(`../../vectors/cli/${name}.json`, import.meta.url))).cases; }
export async function temporary(t) {
  const home = await fs.mkdtemp(join(tmpdir(), 'pdd-pkg test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return home;
}
export async function put(path, text, mode) { await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, text, mode ? { mode } : {}); }
export async function runtime(home, releaseId = 'R1', { client = false, nodeVersion = '22.16.0', version = '1.0.0' } = {}) {
  const root = join(home, '.pdd/versions', releaseId), node = join(home, '.pdd/tools/node', nodeVersion, 'bin/node');
  await fs.mkdir(dirname(node), { recursive: true });
  try { await fs.link(process.execPath, node); } catch (e) { if (e.code !== 'EEXIST') await fs.copyFile(process.execPath, node); }
  const value = { v: 1, releaseId, versionRoot: root, node, bin: join(root, 'bin/pdd.mjs'), pddVersion: version, alphaDigest: `alpha-${releaseId}`, clientDigest: client ? 'C1' : null, nodeVersion, credentialHelper: client ? join(root, 'bin/pdd-cred') : null };
  await put(value.bin, `process.stdout.write(JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),node:process.execPath,release:${JSON.stringify(releaseId)}})+'\\n');process.exitCode=Number(process.env.PDD_TEST_EXIT??0);\n`);
  await put(join(root, 'package.json'), JSON.stringify({ version, type: 'module' }));
  if (client) await put(value.credentialHelper, '#!/bin/sh\nexit 0\n', 0o755);
  await put(join(root, 'runtime.json'), JSON.stringify(value));
  return value;
}
export async function pointer(home, name, value) { await fs.mkdir(join(home, '.pdd'), { recursive: true }); await fs.symlink(value.versionRoot, join(home, '.pdd', name)); }
export async function seed(home, patch = {}) {
  return withUpdateLock({ home }, lease => writeInstallRecord({ home, lease, expectedRev: 0, next: { ...initialInstallRecord(), ...patch } }));
}
export async function mutate(home, action) {
  return withUpdateLock({ home }, async lease => {
    const read = await readInstallRecord({ home }), next = structuredClone(read.value);
    await action(next);
    return writeInstallRecord({ home, lease, expectedRev: read.value.rev, next });
  });
}
export const proof = { pid: 12345, birth: 'synthetic-birth', bootId: 'B1' };
export function pending(id = 'A1', extra = {}) { return { attemptId: id, bootId: 'B1', processProof: proof, startedAt: 0, deadlineAt: 600000, deadlineRegistration: { id: `D-${id}` }, state: 'starting', ...extra }; }
export function start(value, count = 0, attempt = pending()) { return { runtime: value, consecutiveFailures: count, pending: attempt, lastSuccess: null }; }
export function tarFixture(files) {
  const pieces = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), header = Buffer.alloc(512);
    header.write(name); header.write('0000755\0', 100); header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write('0', 156); header.fill(32, 148, 156);
    header.write(header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    pieces.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return Buffer.concat([...pieces, Buffer.alloc(1024)]);
}
