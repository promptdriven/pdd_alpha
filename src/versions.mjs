// Generated from prompts/cli/versions.prompt.md (sha256: 6cb0abedbaed222f41c9c29a2d7a062f56c22f00537c21903f6b081f06b709c1).
import * as fs from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { withUpdateLock } from './update-lock.mjs';

export function runtimeUnavailable() { return Object.assign(new Error('Runtime unavailable. Run ~/.pdd/launcher/pdd-launch recover.'), { code: 'runtime_unavailable' }); }
const inside = (parent, path) => { const part = relative(parent, path); return part !== '' && !part.startsWith('..') && !isAbsolute(part); };
export async function resolveRuntime({ home, versionRoot }, ports = {}) {
  const io = ports.fs ?? fs, base = resolve(home, '.pdd');
  try {
    const root = await io.realpath(versionRoot ?? join(base, 'current'));
    if (!inside(join(base, 'versions'), root) || dirname(root) !== join(base, 'versions')) throw runtimeUnavailable();
    const runtime = JSON.parse(await io.readFile(join(root, 'runtime.json'), 'utf8'));
    if (runtime.v !== 1 || typeof runtime.releaseId !== 'string' || !runtime.releaseId || /[\\/]/.test(runtime.releaseId) || root !== join(base, 'versions', runtime.releaseId) || runtime.versionRoot !== root || typeof runtime.pddVersion !== 'string' || !runtime.pddVersion || typeof runtime.alphaDigest !== 'string' || !runtime.alphaDigest || typeof runtime.nodeVersion !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(runtime.nodeVersion)) throw runtimeUnavailable();
    if (runtime.bin !== join(root, 'bin/pdd.mjs') || runtime.node !== join(base, 'tools/node', runtime.nodeVersion, 'bin/node')) throw runtimeUnavailable();
    if (runtime.clientDigest === null ? runtime.credentialHelper !== null : typeof runtime.clientDigest !== 'string' || !runtime.clientDigest || runtime.credentialHelper !== join(root, 'bin/pdd-cred')) throw runtimeUnavailable();
    for (const path of [runtime.bin, runtime.node, ...(runtime.credentialHelper ? [runtime.credentialHelper] : [])]) {
      if (!isAbsolute(path) || await io.realpath(path) !== path || !(await io.stat(path)).isFile()) throw runtimeUnavailable();
    }
    await io.access(runtime.node, 1);
    const pkg = JSON.parse(await io.readFile(join(root, 'package.json'), 'utf8'));
    if (pkg.version !== runtime.pddVersion || pkg.type !== 'module') throw runtimeUnavailable();
    return runtime;
  } catch { throw runtimeUnavailable(); }
}

// references is an authoritative {complete,references:[Runtime],nodes?:[absolutePath]}
// census, or a function returning one. Each dynamic inventory is reread under lock.
export async function collectVersions({ home, references }, ports = {}) {
  const io = ports.fs ?? fs, base = resolve(home, '.pdd');
  const uncertain = () => ({ removed: [], retained: [], code: 'references_uncertain' });
  const inventory = async () => {
    const supplied = ports.listReferences ?? (typeof references === 'function' ? references : () => references);
    const result = await supplied();
    if (!result?.complete || !Array.isArray(result.references)) throw new Error('incomplete');
    return result;
  };
  let first;
  try { first = await inventory(); } catch { return uncertain(); }
  return (ports.withUpdateLock ?? withUpdateLock)({ home }, async () => {
    try {
      const second = await inventory();
      if (first.revision !== undefined && second.revision !== first.revision) return uncertain();
      const roots = new Set(), nodes = new Set();
      // Support stays independent of candidate activation. Its own complete
      // snapshot and Node remain retained even if a caller forgets that reference.
      try {
        const support = JSON.parse(await io.readFile(join(base, 'launcher/support/runtime.json'), 'utf8'));
        const verified = await resolveRuntime({ home, versionRoot: support.versionRoot }, ports);
        if (support.node !== verified.node || support.alphaDigest !== verified.alphaDigest) return uncertain();
        roots.add(verified.versionRoot);
      } catch (e) {
        if (e.code !== 'ENOENT') return uncertain();
        try { await io.lstat(join(base, 'launcher/support')); return uncertain(); } catch (missing) { if (missing.code !== 'ENOENT') return uncertain(); }
      }
      for (const pointer of ['current', 'previous']) {
        try { roots.add((await resolveRuntime({ home, versionRoot: join(base, pointer) }, ports)).versionRoot); }
        catch { if (pointer === 'current') return uncertain(); try { await io.lstat(join(base, pointer)); return uncertain(); } catch (e) { if (e.code !== 'ENOENT') return uncertain(); } }
      }
      // Both snapshots remain retained if a new reference arrives between censuses.
      for (const census of [first, second]) {
        for (const ref of census.references) {
          const root = typeof ref === 'string' ? ref : ref?.versionRoot;
          const runtime = await resolveRuntime({ home, versionRoot: root }, ports);
          if (typeof ref === 'object' && (ref.alphaDigest !== runtime.alphaDigest || ref.node !== runtime.node)) return uncertain();
          roots.add(runtime.versionRoot);
        }
        for (const node of census.nodes ?? []) {
          if (!inside(join(base, 'tools/node'), node) || await io.realpath(node) !== node) return uncertain();
          nodes.add(dirname(dirname(node)));
        }
      }
      const versions = await io.readdir(join(base, 'versions'), { withFileTypes: true });
      const candidates = [];
      for (const entry of versions) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) return uncertain();
        const runtime = await resolveRuntime({ home, versionRoot: join(base, 'versions', entry.name) }, ports);
        if (roots.has(runtime.versionRoot)) nodes.add(dirname(dirname(runtime.node)));
        else candidates.push(runtime);
      }
      const nodeDirs = await io.readdir(join(base, 'tools/node'), { withFileTypes: true });
      if (nodeDirs.some(e => !e.isDirectory() || !/^\d+\.\d+\.\d+$/.test(e.name))) return uncertain();
      // Recheck immediately before destructive effects; a changing inventory is unsafe.
      const final = await inventory();
      if (JSON.stringify(final) !== JSON.stringify(second)) return uncertain();
      const removed = [];
      for (const runtime of candidates) { await io.rm(runtime.versionRoot, { recursive: true }); removed.push(runtime.releaseId); }
      for (const entry of nodeDirs) {
        const path = join(base, 'tools/node', entry.name);
        if (!nodes.has(path)) await io.rm(path, { recursive: true });
      }
      return { removed, retained: [...roots].map(root => root.slice(root.lastIndexOf('/') + 1)).sort(), code: null };
    } catch { return uncertain(); }
  }, ports);
}
