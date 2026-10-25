// Generated from prompts/cli/owned-node.prompt.md (sha256: c52d8770e74b20c1b162707253e0c33a47a753b17d0909e314c0a977202b5ecd).
import * as fs from 'node:fs/promises';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash, verify, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validUpdateLease } from './update-lock.mjs';
import { durableJson } from './install-record.mjs';

const execute = promisify(execFile);
const safeId = s => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) && s !== '..';
const error = code => ({ code, next: 'Obtain the matching verified runtime from the release owner, then rerun pdd setup.' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function downloadArtifact(artifact) {
  if (!artifact.url?.startsWith('https://')) throw new Error('HTTPS required');
  const response = await fetch(artifact.url, { redirect: 'error' });
  if (!response.ok) throw new Error('download failed');
  return Buffer.from(await response.arrayBuffer());
}
export async function verifyArtifactBytes(artifact, bytes, ports = {}) {
  const match = /^(sha256|sha512)-([A-Za-z0-9+/]+=*)$/.exec(artifact.integrity ?? '');
  if (!match || createHash(match[1]).update(bytes).digest('base64') !== match[2]) return false;
  if (ports.verifyArtifact) return await ports.verifyArtifact(artifact, bytes) === true;
  const authority = artifact.authority, key = ports.trustedKeys?.[authority?.keyId];
  if (!key || !authority?.signature) return false;
  try { return verify(null, bytes, key, Buffer.from(authority.signature, 'base64')); } catch { return false; }
}

// Validate the entire archive before creating a single member. Links are created last.
export async function extractVerifiedTar(bytes, destination, { strip = 1 } = {}) {
  const tar = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  const entries = [], paths = new Set();
  const string = b => b.toString('utf8').split('\0')[0];
  const contained = path => { const r = relative(destination, path); return r !== '' && !r.startsWith('..') && !isAbsolute(r); };
  for (let offset = 0; offset + 512 <= tar.length;) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every(x => x === 0)) break;
    const sizeText = string(block.subarray(124, 136)).trim(), checksum = parseInt(string(block.subarray(148, 156)).trim(), 8);
    let actual = 0; for (let i = 0; i < 512; i++) actual += i >= 148 && i < 156 ? 32 : block[i];
    if (!/^[0-7]+$/.test(sizeText) || checksum !== actual) throw new Error('invalid tar');
    const size = parseInt(sizeText, 8), prefix = string(block.subarray(345, 500));
    const name = (prefix ? `${prefix}/` : '') + string(block.subarray(0, 100));
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error('archive escape');
    const parts = name.split('/').filter(x => x && x !== '.');
    const target = join(destination, ...parts.slice(strip)), type = string(block.subarray(156, 157)) || '0';
    if (offset + 512 + size > tar.length || !Number.isSafeInteger(size)) throw new Error('truncated tar');
    if (parts.length > strip) {
      if (!contained(target) || paths.has(target) || !['0', '5', '2', '1'].includes(type)) throw new Error('unsupported member');
      const link = string(block.subarray(157, 257));
      const linkTarget = type === '1' ? join(destination, ...link.split('/').slice(strip)) : resolve(dirname(target), link);
      if (['1', '2'].includes(type) && (!contained(linkTarget) || isAbsolute(link))) throw new Error('link escape');
      const mode = parseInt(string(block.subarray(100, 108)).trim(), 8) & 0o777;
      entries.push({ target, type, link, linkTarget, mode, data: tar.subarray(offset + 512, offset + 512 + size) }); paths.add(target);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const links = entries.filter(e => ['1', '2'].includes(e.type));
  if (entries.some(e => links.some(l => e.target !== l.target && e.target.startsWith(`${l.target}/`)))) throw new Error('link parent');
  // Resolve symlinks as the filesystem does: normalizing '..' before following
  // an intermediate symlink can conceal an escape through a shorter target.
  const symlinks = new Map(links.filter(e => e.type === '2').map(e => [e.target, e.link]));
  for (const e of links.filter(e => e.type === '2')) {
    const pending = [...relative(destination, dirname(e.target)).split('/'), ...e.link.split('/')], resolved = [];
    let expansions = 0;
    while (pending.length) {
      const part = pending.shift();
      if (!part || part === '.') continue;
      if (part === '..') { if (!resolved.length) throw new Error('link escape'); resolved.pop(); continue; }
      resolved.push(part);
      const link = symlinks.get(join(destination, ...resolved));
      if (link !== undefined) {
        if (++expansions > 40) throw new Error('cyclic link');
        resolved.pop(); pending.unshift(...link.split('/'));
      }
    }
    if (!resolved.length) throw new Error('link escape');
  }
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  for (const e of entries.filter(e => !['1', '2'].includes(e.type))) {
    await fs.mkdir(dirname(e.target), { recursive: true });
    if (e.type === '5') await fs.mkdir(e.target, { recursive: true, mode: e.mode });
    else await fs.writeFile(e.target, e.data, { flag: 'wx', mode: e.mode });
  }
  for (const e of links) {
    await fs.mkdir(dirname(e.target), { recursive: true });
    if (e.type === '2') await fs.symlink(e.link, e.target);
    else { if (!(await fs.lstat(e.linkTarget)).isFile()) throw new Error('invalid hardlink'); await fs.link(e.linkTarget, e.target); }
  }
}
export async function directoryDigest(root) {
  const digest = createHash('sha256');
  async function walk(path, name) {
    const st = await fs.lstat(path);
    digest.update(`${name}\0${st.mode & 0o777}\0`);
    if (st.isSymbolicLink()) {
      const target = await fs.realpath(path);
      if (!target.startsWith(`${await fs.realpath(root)}/`)) throw new Error('escape');
      digest.update(JSON.stringify(['link', await fs.readlink(path)]));
    } else if (st.isDirectory()) { for (const child of (await fs.readdir(path)).sort()) await walk(join(path, child), `${name}/${child}`); }
    else if (st.isFile()) digest.update(JSON.stringify(['file', sha(await fs.readFile(path))]));
    else throw new Error('unsupported file');
  }
  for (const child of (await fs.readdir(root)).filter(s => !['.pdd-node.json', '.pdd-release.json', 'runtime.json'].includes(s)).sort()) await walk(join(root, child), child);
  return digest.digest('hex');
}
function versionAtLeast(version, minimum) {
  const a = version.split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return true;
}
export async function stageOwnedNode({ home, artifact, platform = process.platform, arch = process.arch, transactionId }, ports = {}) {
  if (!['linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch) || artifact?.platform !== platform || artifact?.arch !== arch || (ports.isWSL && !ports.wslEnabled)) return error('unsupported_runtime');
  if (!safeId(transactionId) || !/^\d+\.\d+\.\d+$/.test(artifact?.version ?? '') || !versionAtLeast(artifact.version, '22.16.0') || (artifact.minimum && (!/^\d+\.\d+\.\d+$/.test(artifact.minimum) || !versionAtLeast(artifact.version, artifact.minimum))) || !artifact.url?.startsWith('https://') || !artifact.integrity || !artifact.authority) return error('runtime_verification_failed');
  const path = join(resolve(home), '.pdd/update/staging', transactionId, `node-${randomUUID()}`);
  try {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    if (await fs.realpath(dirname(path)) !== dirname(path)) return error('runtime_verification_failed');
  } catch { return error('runtime_io'); }
  let bytes;
  try { bytes = Buffer.from(await (ports.downloadArtifact ?? downloadArtifact)(artifact)); } catch { return error('runtime_download_failed'); }
  try {
    if (!await verifyArtifactBytes(artifact, bytes, ports)) return error('runtime_verification_failed');
    await (ports.extractArchive ?? extractVerifiedTar)(bytes, path);
    const node = join(path, 'bin/node');
    if (await fs.realpath(node) !== node || !(await fs.stat(node)).isFile()) return error('runtime_verification_failed');
    const probe = ports.probeNode ? await ports.probeNode(node) : JSON.parse((await execute(node, ['-p', 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})'], { timeout: 30000 })).stdout);
    if (probe.version !== artifact.version || probe.platform !== platform || probe.arch !== arch) return error('runtime_verification_failed');
    const treeDigest = await directoryDigest(path), artifactIdentity = sha(bytes);
    await durableJson(join(path, '.pdd-node.json'), { artifactIdentity, treeDigest, nodeVersion: artifact.version, platform, arch });
    return { stagedNode: node, nodeVersion: artifact.version, artifactIdentity };
  } catch (e) { await fs.rm(path, { recursive: true, force: true }).catch(() => {}); return error(['ENOSPC', 'EACCES', 'EROFS'].includes(e.code) ? 'runtime_io' : 'runtime_verification_failed'); }
}
export async function ensureOwnedNode({ home, staged, lease }, ports = {}) {
  if (!validUpdateLease(lease, home)) return error('lock_unavailable');
  try {
    const root = dirname(dirname(staged.stagedNode)), base = join(resolve(home), '.pdd');
    if (!root.startsWith(`${base}/update/staging/`) || await fs.realpath(root) !== root) return error('runtime_verification_failed');
    const receipt = JSON.parse(await fs.readFile(join(root, '.pdd-node.json'), 'utf8'));
    if (receipt.artifactIdentity !== staged.artifactIdentity || receipt.nodeVersion !== staged.nodeVersion || !/^\d+\.\d+\.\d+$/.test(staged.nodeVersion) || receipt.treeDigest !== await directoryDigest(root)) return error('runtime_verification_failed');
    const final = join(base, 'tools/node', staged.nodeVersion);
    await fs.mkdir(dirname(final), { recursive: true, mode: 0o700 });
    if (await fs.realpath(dirname(final)) !== dirname(final)) return error('runtime_verification_failed');
    try {
      const previous = JSON.parse(await fs.readFile(join(final, '.pdd-node.json'), 'utf8'));
      if (previous.artifactIdentity !== receipt.artifactIdentity || previous.treeDigest !== await directoryDigest(final)) return error('runtime_verification_failed');
      return { node: await fs.realpath(join(final, 'bin/node')), nodeVersion: staged.nodeVersion, changed: false };
    } catch (e) { if (e.code !== 'ENOENT') throw e; try { await fs.lstat(final); return error('runtime_verification_failed'); } catch (absent) { if (absent.code !== 'ENOENT') throw absent; } }
    await fs.rename(root, final);
    return { node: await fs.realpath(join(final, 'bin/node')), nodeVersion: staged.nodeVersion, changed: true };
  } catch { return error('runtime_io'); }
}
