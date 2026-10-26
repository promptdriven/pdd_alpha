// Generated from prompts/cli/argument-parser.prompt.md (sha256: fcd68af51761a17fdca14c758a97993678c2bddbd745424b05e2ad1c350913c8).
import { PUBLIC_COMMAND_ROUTES } from './command-catalog.mjs';

export class CommandInputError extends Error {
  constructor(message) { super(message); this.name = 'CommandInputError'; this.exitCode = 2; }
}
const fail = () => { throw new CommandInputError('Unsupported command or options in PDD Alpha. Run pdd --help for local authoring tools.'); };
const routes = [...PUBLIC_COMMAND_ROUTES].sort((a, b) => b.prefix.length - a.prefix.length);
const matches = (route, words) => route.prefix.every((token, index) => words[index] === token);
const findRoute = words => routes.find(route => matches(route, words));
const help = prefix => Object.freeze({ commandId: 'help', local: 'help', helpPrefix: Object.freeze([...prefix]) });
function helpFor(words) {
  if (!words.length) return help([]);
  const route = findRoute(words);
  if (route && route.prefix.length === words.length) return help(words);
  if (words.length === 1 && routes.some(route => route.prefix[0] === words[0])) return help(words);
  fail();
}
function parseRoute(route, words) {
  const options = Object.create(null), operands = []; let literal = false;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word === '--' && route.local === 'session' && !literal) { literal = true; continue; }
    if (!literal && word.startsWith('-')) {
      const option = route.options.find(option => option.name === word);
      if (['--account','--mode'].includes(word) && (route.local === 'session' || route.id === 'workflow.run'))
        throw new CommandInputError('Set accounts per machine and tool in Settings');
      if (!option || Object.hasOwn(options, word)) fail();
      if (option.kind === 'flag') options[word] = true;
      else {
        const value = words[++index];
        if (value === undefined || !value.length || value.startsWith('--') || option.choices && !option.choices.includes(value)) fail();
        options[word] = value;
      }
    } else operands.push(word);
  }
  const minimum = route.operands.filter(item => !item.optional).length;
  if (operands.length < minimum || !route.operands.at(-1)?.repeat && operands.length > route.operands.length) fail();
  for (let index = 0; index < operands.length; index++) {
    const type = route.operands[Math.min(index, route.operands.length - 1)].type;
    const word = operands[index];
    const valid = type === 'text' || type === 'workflow-name' && word.length<=64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(word) || type === 'issue'
      && /^(?:[1-9][0-9]*|[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+#[1-9][0-9]*|https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*\/?)$/.test(word)
      || type === 'uuid' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(word)
      || type.startsWith('choice:') && type.slice(7).split(',').includes(word);
    if (!valid) fail();
  }
  const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
  const positive = v => typeof v === 'string' && /^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v));
  const present = n => options[n] !== undefined;
  for (const name of ['--id','--launch-id']) if (present(name) && !uuid(options[name])) fail();
  for (const name of ['--rev','--expect-seq']) if (present(name) && !positive(options[name])) fail();
  if (present('--expect-stage') && (options['--expect-stage'].length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options['--expect-stage']))) fail();
  if (route.id.startsWith('workflow.') && ['resume','drive','decide'].includes(route.prefix[1])) {
    if (present('--expect-stage') !== present('--expect-seq')) fail();
    if ((present('--id') || present('--rev') || present('--expect-stage')) && !present('--decision')) fail();
    if ((present('--rev') || present('--expect-stage')) && !present('--id')) fail();
    if (route.id === 'workflow.decide' && (!present('--decision') || !present('--id') || !(present('--rev') || present('--expect-stage')))) fail();
    if (route.id === 'workflow.drive' && present('--decision') && (!present('--id') || !(present('--rev') || present('--expect-stage')))) fail();
  }
  if (route.id === 'doctor' && Object.keys(options).length > 1) fail();
  if (route.id === 'models' && !present('--agent')) fail();
  if (route.id === 'settings') {
    if (operands.length === 1) fail();
    if (operands.length === 2) {
      const [key,val] = operands;
      const choices = {'auto-switch-my-sessions':['on','off'],'auto.order':['earliest-reset','most-remaining'],alerts:['on','off'],'alert-text':['show','hide']};
      if (!['model','effort','projects.base',...Object.keys(choices)].includes(key) || !val.trim()
        || ['model','effort'].includes(key) && !present('--tool') || choices[key] && !choices[key].includes(val)) fail();
    }
  }
  if (route.id === 'update') {
    const actions = Object.keys(options).filter(n=>!['--fleet','--force'].includes(n));
    if (actions.length > 1 || present('--force') && !present('--to') && !present('--rollback')) fail();
  }
  if (['agent.send','agent.keys','agent.resume','agent.stop'].includes(route.id) && !present('--id')) fail();
  if (route.id === 'agent.stop' && !present('--how')) fail();
  if (route.id === 'accounts.quota-decide' && (!present('--decision') || !present('--rev'))) fail();
  if (route.id === 'accounts.add' && (present('--from-pool') && operands[0]!=='codex' || present('--replace') && operands[0]==='codex')) fail();
  if (route.id === 'accounts.allow' && !present('--machine')) fail();
  if (route.id === 'accounts.policy' && present('--pinned') !== present('--then')) fail();
  return Object.freeze({ commandId: route.id, local: route.local, ...(route.workflowName ? { workflowName: route.workflowName } : {}),
    operands: Object.freeze(operands), options: Object.freeze({ ...options }) });
}
export function parseArgv(argv) {
  if (!Array.isArray(argv) || argv.some(word => typeof word !== 'string' || word.includes('\0'))) fail();
  if (!argv.length || argv.length === 1 && ['--help', '-h'].includes(argv[0])) return help([]);
  if (argv[0] === 'help') return helpFor(argv.slice(1));
  if (['--help', '-h', 'help'].includes(argv.at(-1)) && !(findRoute(argv)?.local === 'session' && argv.includes('--'))) {
    const words = argv.slice(0, -1), route = findRoute(words);
    if (!route || route.prefix.length === words.length) return helpFor(words);
    parseRoute(route, words.slice(route.prefix.length));
    return help(route.prefix);
  }
  const route = findRoute(argv);
  if (!route) fail();
  return parseRoute(route, argv.slice(route.prefix.length));
}
