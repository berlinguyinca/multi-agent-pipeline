const flagsWithValues = new Set([
  '--output-dir',
  '--config',
  '--resume',
  '--total-timeout',
  '--inactivity-timeout',
  '--poll-interval',
  '--github-issue',
  '--personality',
]);

export function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

export function extractPrompt(args: string[]): string {
  return args
    .filter(
      (arg, idx) =>
        !arg.startsWith('--') &&
        !(idx > 0 && flagsWithValues.has(args[idx - 1] ?? '')),
    )
    .join(' ')
    .trim();
}
