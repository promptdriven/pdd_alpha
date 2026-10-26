// Generated from prompts/cli/npm-cleanup.prompt.md (sha256: 8786264da1dcb7f5800e9788cda8afc0e1ffc27407dbf5cbae5ec8b5dc0dbf5f).
import * as fs from 'node:fs/promises';
import { join, dirname, delimiter, isAbsolute, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const legacyRepository = value => typeof value === 'string' && /^(?:promptdriven\/pdd_alpha|github:promptdriven\/pdd_alpha|(?:git\+)?(?:https?|git):\/\/github\.com\/promptdriven\/pdd_alpha|(?:git\+)?ssh:\/\/git@github\.com\/promptdriven\/pdd_alpha|git@github\.com:promptdriven\/pdd_alpha)(?:\.git)?\/?$/.test(value);
const failure = () => Object.assign(new Error('legacy_npm_cleanup_failed'), { code: 'legacy_npm_cleanup_failed' });

export async function cleanupLegacyNpm(ports = {}) {
  const env = ports.env ?? process.env, run = ports.execFile ?? execute;
  let npm;
  for (const folder of (env.PATH ?? '').split(delimiter)) {
    const candidate = resolve(folder || '.', 'npm');
    try {
      if (!(await fs.stat(candidate)).isFile()) continue;
      await fs.access(candidate, 1); npm = candidate; break;
    } catch {}
  }
  if (!npm) return false;
  const options = { encoding: 'utf8', timeout: 30000, maxBuffer: 65536, env: {
    ...env, PATH: `${dirname(ports.node ?? process.execPath)}${delimiter}${env.PATH ?? ''}`,
    npm_config_dry_run: 'false', npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false'
  } };
  let root;
  try { root = (await run(npm, ['root', '--global'], options)).stdout.trim(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw failure(); }
  if (!isAbsolute(root) || /[\r\n\0]/.test(root)) throw failure();
  let metadata;
  try { metadata = JSON.parse(await fs.readFile(join(root, 'pdd/package.json'), 'utf8')); }
  catch { return false; }
  if (metadata?.name !== 'pdd' || !legacyRepository(typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url)) return false;
  try { await run(npm, ['uninstall', '--global', '--ignore-scripts', '--no-audit', '--no-fund', 'pdd'], options); }
  catch { throw failure(); }
  try { await fs.lstat(join(root, 'pdd')); }
  catch (error) { if (error.code !== 'ENOENT') throw failure(); root = null; }
  if (root !== null) throw failure();
  (ports.stdout ?? process.stdout).write('Removed old global npm pdd (promptdriven/pdd_alpha).\n');
  return true;
}
