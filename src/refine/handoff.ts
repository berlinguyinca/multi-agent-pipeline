import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RefineResult } from './refiner.js';

export interface RefineHandoff {
  version: 1;
  savedAt: string;
  refinedPromptPath: string;
  result: RefineResult;
}

export function refineHandoffPaths(outputDir: string): { dir: string; promptPath: string; metadataPath: string } {
  const dir = path.join(path.resolve(outputDir), '.map', 'refine');
  return {
    dir,
    promptPath: path.join(dir, 'refined-prompt.md'),
    metadataPath: path.join(dir, 'refined-result.json'),
  };
}

export async function saveRefineHandoff(outputDir: string, result: RefineResult, now = new Date()): Promise<RefineHandoff> {
  const paths = refineHandoffPaths(outputDir);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.promptPath, `${result.refinedPrompt.trimEnd()}\n`, 'utf8');
  const handoff: RefineHandoff = {
    version: 1,
    savedAt: now.toISOString(),
    refinedPromptPath: paths.promptPath,
    result,
  };
  await fs.writeFile(paths.metadataPath, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
  return handoff;
}

export async function loadRefineHandoff(outputDir: string): Promise<RefineHandoff | null> {
  const paths = refineHandoffPaths(outputDir);
  try {
    const raw = await fs.readFile(paths.metadataPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRefineHandoff(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isRefineHandoff(value: unknown): value is RefineHandoff {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const result = record['result'];
  return record['version'] === 1 &&
    typeof record['savedAt'] === 'string' &&
    typeof record['refinedPromptPath'] === 'string' &&
    typeof result === 'object' &&
    result !== null &&
    !Array.isArray(result) &&
    (result as Record<string, unknown>)['mode'] === 'refine' &&
    typeof (result as Record<string, unknown>)['refinedPrompt'] === 'string';
}
