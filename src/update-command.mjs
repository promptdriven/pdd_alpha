// Generated from prompts/cli/update-command.prompt.md (sha256: de69a3f369049bb19cc6c46a0507331db86a70245ac9d55cc27fbd5ca48f19c7).
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveRuntime } from './versions.mjs';
import { readInstallRecord } from './install-record.mjs';

const label = value => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 256);
const unavailable = 'This public package does not include the release selector. Update availability has not been checked.';

export async function runUpdateCommand({ action = null, fleet = false } = {}, ports = {}) {
  if (fleet) return { state: 'unavailable', code: 1, message: 'Fleet updates need the fleet client. No remote status was read or changed.' };
  if (action !== null) return { state: 'unavailable', code: 1, message: `${unavailable} No update or setting was changed. Use a verified PDD installer for a newer release.` };
  const home = ports.home ?? homedir(), io = ports.fs ?? fs;
  async function version(name) {
    const path = join(home, '.pdd', name);
    try { await io.lstat(path); }
    catch (error) { return error.code === 'ENOENT' ? 'none' : 'unavailable (cannot read local state)'; }
    try {
      const runtime = await resolveRuntime({ home, versionRoot: path }, ports);
      return `${label(runtime.pddVersion)} (${label(runtime.releaseId)})`;
    } catch { return 'unavailable (runtime metadata could not be verified; run pdd doctor)'; }
  }
  const [current, previous] = await Promise.all([version('current'), version('previous')]);
  let record;
  try { record = await readInstallRecord({ home }, ports); }
  catch { record = { value: null, code: 'record_io' }; }
  const value = record.code ? null : record.value;
  const mode = ['auto', 'ask', 'never'].includes(value?.mode) ? value.mode : 'not recorded';
  const channel = ['stable', 'beta'].includes(value?.channel) ? value.channel : 'not recorded';
  const pin = value?.pin === null ? 'none' : typeof value?.pin === 'string' && value.pin.trim() ? label(value.pin) : 'not recorded';
  const lines = [`Current: ${current}`, `Previous: ${previous}`, 'Target: unavailable (release selector not included)',
    `Mode: ${mode}`, `Channel: ${channel}`, `Pin: ${pin}`, unavailable];
  if (record.code) lines.push(record.code === 'record_damaged' ? 'Local update record is damaged. Run pdd doctor before changing the installation.'
    : record.code === 'recovery_required' ? 'Local installation needs recovery. Run pdd doctor.' : 'Local update record could not be read. Check its permissions and run pdd doctor.');
  return { state: 'shown', code: 0, message: lines.join('\n') };
}
