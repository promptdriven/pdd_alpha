// Generated from prompts/cli/pdd-directory.prompt.md (sha256: a02141327e515cca3833751894481b0c8af2cdd9a099660c31fa39b9bec3f701).
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const execute = promisify(execFile);
const helper = fileURLToPath(new URL(`../launcher/native/${process.platform}-${process.arch}/pdd-directory`, import.meta.url));
const mutableChildren = new Set(['logs', 'runs', 'fleet', 'accounts', 'claims', 'install', 'link']);
const same = (a, b) => String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
const owned = s => s.isDirectory() && String(s.uid) === String(process.geteuid());
const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

async function secureDirectory(path, io, repairExisting, parent, identities) {
  let before;
  try { before = await io.lstat(path, { bigint: true }); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const expected = identities.get(path);
  if (before && !owned(before) || expected && (!before || !same(before, expected))) throw new Error('unsafe directory');
  let handle;
  try {
    if (before) {
      handle = await io.open(path, flags);
      const opened = await handle.stat({ bigint: true });
      if (!owned(opened) || !same(before, opened)) throw new Error('directory replaced');
    }
    // mkdirat/openat/fchmod bind every mutation to this previously verified
    // parent identity; a path-only check cannot protect an absent child.
    const { stdout } = await execute(helper, [path, repairExisting ? '1' : '0', String(parent.dev), String(parent.ino), before ? String(before.dev) : '-', before ? String(before.ino) : '-']);
    const [dev, ino] = stdout.trim().split(' ');
    if (!handle) handle = await io.open(path, flags);
    const opened = await handle.stat({ bigint: true }), after = await io.lstat(path, { bigint: true });
    if (!owned(opened) || String(opened.dev) !== dev || String(opened.ino) !== ino || !same(after, opened) ||
        !after.isDirectory() || (!before || repairExisting) && (Number(after.mode) & 0o7777) !== 0o700 ||
        !same(await io.lstat(dirname(path), { bigint: true }), parent) || await io.realpath(path) !== path) throw new Error('directory replaced');
    identities.set(path, opened);
    return opened;
  } finally { if (handle) await handle.close(); }
}

async function ensure(directory, io, identities, normalize = false) {
  const target = resolve(directory), segments = target.split('/'), index = segments.indexOf('.pdd');
  const root = index < 0 ? target : join('/', ...segments.slice(0, index + 1));
  const components = index < 0 ? [] : segments.slice(index + 1);
  const parents = async path => {
    try {
      if (await io.realpath(path) !== path) throw new Error('aliased directory parent');
      const stat = await io.lstat(path, { bigint: true });
      if (!stat.isDirectory() || identities.has(path) && !same(stat, identities.get(path))) throw new Error('directory replaced');
      identities.set(path, stat); return stat;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const parent = await parents(dirname(path));
      return secureDirectory(path, io, false, parent, identities);
    }
  };
  let parent = await parents(dirname(root));
  parent = await secureDirectory(root, io, index >= 0 || normalize && root === target, parent, identities);
  let current = root;
  for (let i = 0; i < components.length; i++) {
    current = join(current, components[i]);
    parent = await secureDirectory(current, io, i === 0 && mutableChildren.has(components[i]) || normalize && current === target, parent, identities);
  }
  return target;
}

export async function ensurePrivateDirectory(directory, io = fs) {
  return ensure(directory, io, new Map());
}

export async function repairPrivatePddHome(directory, io = fs) {
  const identities = new Map();
  await ensure(directory, io, identities);
  for (const name of mutableChildren) {
    const path = join(directory, name);
    try { await io.lstat(path); }
    catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    await ensure(path, io, identities);
  }
}

export async function repairPrivateTree(directory, io = fs) {
  const identities = new Map();
  const walk = async path => {
    await ensure(path, io, identities, true);
    for (const name of await io.readdir(path)) {
      const child = join(path, name), stat = await io.lstat(child);
      if (stat.isDirectory()) await walk(child);
    }
  };
  await walk(resolve(directory));
}
