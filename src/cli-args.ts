export function extractSubcommand(args: string[]): { command: string; subArgs: string[] } | null {
  if (args.length === 0) return null;
  const first = args[0];
  if (first.startsWith('-')) return null;
  const knownCommands = ['agent'];
  if (!knownCommands.includes(first)) return null;
  return { command: first, subArgs: args.slice(1) };
}

const flagsWithValues = new Set([
  '--output-dir',
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
  '--ollama-host',
  '--ollama-context-length',
  '--ollama-num-parallel',
  '--ollama-max-loaded-models',
  '--github-issue',
  '--spec-file',
  '--personality',
  '--review-pr',
  '--output-format',
  '--dag-layout',
]);

const booleanFlags = new Set([
  '--headless',
  '--v2',
  '--classic',
  '--verbose',
  '-V',
  '--compact',
  '--open-output',
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
        !(idx > 0 && flagsWithValues.has(args[idx - 1] ?? '')),
    )
    .join(' ')
    .trim();
}
