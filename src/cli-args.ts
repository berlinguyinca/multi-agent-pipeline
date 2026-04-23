export function extractSubcommand(args: string[]): { command: string; subArgs: string[] } | null {
  if (args.length === 0) return null;
  const first = args[0];
  if (first.startsWith('-')) return null;
  const knownCommands = ['agent', 'evidence', 'refine'];
  if (!knownCommands.includes(first)) return null;
  return { command: first, subArgs: args.slice(1) };
}

const flagsWithValues = new Set([
  '--output-dir',
  '--ouputDir',
  '--workspace-dir',
  '--target-dir',
  '--config',
  '--resume',
  '--total-timeout',
  '--inactivity-timeout',
  '--poll-interval',
  '--router-timeout',
  '--router-model',
  '--router-consensus-models',
  '--disable-agent',
  '--disable-agents',
  '--compare-agent-list',
  '--judge-panel-models',
  '--judge-panel-roles',
  '--judge-panel-max-rounds',
  '--cross-review-max-rounds',
  '--cross-review-judge-models',
  '--ollama-host',
  '--ollama-context-length',
  '--ollama-num-parallel',
  '--ollama-max-loaded-models',
  '--github-issue',
  '--youtrack-issue',
  '--spec-file',
  '--refined-prompt',
  '--personality',
  '--review-pr',
  '--output-format',
  '--dag-layout',
  '--output',
]);

const booleanFlags = new Set([
  '--headless',
  '--v2',
  '--classic',
  '--verbose',
  '-V',
  '--silent',
  '--compact',
  '--graph',
  '--open-output',
  '--compare-agents',
  '--semantic-judge',
  '--judge-panel-steer',
  '--disable-cross-review',
  '--refine',
  '--run',
]);

export function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export function extractPrompt(args: string[]): string {
  return args
    .filter(
      (arg, idx) =>
        !arg.startsWith('--') &&
        !booleanFlags.has(arg) &&
        !(idx > 0 && args[idx - 1] === '--compare-agents' && isCompareAgentsValue(args, idx)) &&
        !(idx > 0 && flagsWithValues.has(args[idx - 1] ?? '')),
    )
    .join(' ')
    .trim();
}

function isCompareAgentsValue(args: string[], index: number): boolean {
  const value = args[index];
  if (!value || value.startsWith('--')) return false;
  if (value.includes(',')) return true;
  return args.slice(index + 1).some((arg) => !arg.startsWith('--'));
}
