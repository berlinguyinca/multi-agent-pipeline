import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { refinePromptHeadless, type RefineResult } from '../refine/refiner.js';

export async function handleRefineCommand(args: string[]): Promise<RefineResult> {
  const outputPath = flagValue(args, '--output');
  const headless = args.includes('--headless') || !process.stdin.isTTY;
  const prompt = args.filter((arg, index) =>
    !arg.startsWith('--') &&
    !(index > 0 && args[index - 1] === '--output') &&
    arg !== 'refine',
  ).join(' ').trim();

  const inputPrompt = prompt || (headless ? '' : await askPrompt());
  const result = refinePromptHeadless({ prompt: inputPrompt, headless, outputPath });
  if (outputPath) {
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await fs.writeFile(outputPath, `${result.refinedPrompt.trimEnd()}\n`, 'utf8');
  }
  if (!outputPath) {
    console.log(result.refinedPrompt);
  }
  return result;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

async function askPrompt(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question('What rough prompt should MAP refine?\n> ');
  } finally {
    rl.close();
  }
}
