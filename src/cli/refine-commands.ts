import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { extractPrompt } from '../cli-args.js';
import { refinePromptHeadless, type RefineQuestion, type RefineResult } from '../refine/refiner.js';

export async function handleRefineCommand(args: string[]): Promise<RefineResult> {
  const outputPath = flagValue(args, '--output');
  const headless = args.includes('--headless') || !process.stdin.isTTY;
  const prompt = extractPrompt(args.filter((arg) => arg !== 'refine'));

  const inputPrompt = prompt || (headless ? '' : await askPrompt());
  const initial = refinePromptHeadless({ prompt: inputPrompt, headless, outputPath });
  const answers = !headless ? await askRefineAnswers(initial.questionDetails) : [];
  const result = answers.length > 0
    ? refinePromptHeadless({ prompt: inputPrompt, headless, outputPath, answers })
    : initial;
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


async function askRefineAnswers(questions: RefineQuestion[]): Promise<string[]> {
  if (questions.length === 0) return [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answers: string[] = [];
    console.log('MAP refine needs a few answers before execution.');
    for (const [index, entry] of questions.entries()) {
      answers.push(await rl.question(`${index + 1}. ${entry.question}\n> `));
    }
    return answers;
  } finally {
    rl.close();
  }
}

async function askPrompt(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question('What rough prompt should MAP refine?\n> ');
  } finally {
    rl.close();
  }
}
