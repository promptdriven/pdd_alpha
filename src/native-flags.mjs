// Generated from prompts/cli/native-flags.prompt.md (sha256: 5be6359a79da61653edc04b88a2e8ef38e51446bf9dd83addb5a7c2d9a8364f8).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) throw new TypeError('options must be an object');
  if (input.agent !== 'codex' && input.agent !== 'claude') throw new TypeError('invalid agent');
  if (typeof input.cwd !== 'string' || !input.cwd.startsWith('/') || input.cwd.includes('\0')) throw new TypeError('invalid cwd');
  for (const ch of input.cwd) {
    const c = ch.codePointAt(0);
    if (c >= 0xd800 && c <= 0xdfff) throw new TypeError('invalid cwd');
  }
  if (input.fullAccess !== undefined && typeof input.fullAccess !== 'boolean') throw new TypeError('invalid fullAccess');
  if (input.resume !== undefined && input.resume !== null && (typeof input.resume !== 'string' || !UUID.test(input.resume))) throw new TypeError('invalid resume');
}

function tomlString(value) {
  let out = '"';
  for (const ch of value) {
    const c = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (c === 8) out += '\\b';
    else if (c === 9) out += '\\t';
    else if (c === 10) out += '\\n';
    else if (c === 12) out += '\\f';
    else if (c === 13) out += '\\r';
    else if (c <= 0x1f || c === 0x7f) out += `\\u${c.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out + '"';
}

export function nativeArgs(input) {
  assertInput(input);
  const { agent, cwd, fullAccess = true, resume = null, selection = null } = input;
  const nativeDefault = selection && typeof selection === 'object' && !Array.isArray(selection) && selection.source === 'native-defaults' && selection.agent === agent
    && typeof selection.machineId === 'string' && selection.machineId.length > 0
    && selection.model === null && selection.effort === null && selection.cliVersion === null && selection.catalogRevision === null;
  if (selection !== null && !nativeDefault && (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || typeof selection.model !== 'string' || !selection.model.length
    || !(selection.effort === null || typeof selection.effort === 'string' && selection.effort.length)))
    throw new TypeError('invalid selection');
  const modelArgs = selection === null || nativeDefault ? [] : agent === 'codex'
    ? ['-m', selection.model, ...(selection.effort === null ? [] : ['-c', `model_reasoning_effort=${tomlString(selection.effort)}`])]
    : ['--model', selection.model, ...(selection.effort === null ? [] : ['--effort', selection.effort])];
  const args = [];
  if (agent === 'codex') {
    if (resume !== null) args.push('resume');
    args.push('--no-daemon');
    if (fullAccess) args.push('--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '-c', 'check_for_update_on_startup=false', '-c', `projects={${tomlString(cwd)}={trust_level="trusted"}}`);
    else args.push('-c', 'check_for_update_on_startup=false');
    args.push(...modelArgs);
    if (resume !== null) args.push(resume);
  } else {
    if (fullAccess) args.push('--dangerously-skip-permissions');
    args.push(...modelArgs);
    if (resume !== null) args.push('--resume', resume);
  }
  return args;
}
