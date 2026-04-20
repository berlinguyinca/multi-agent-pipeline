import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadRefineHandoff, refineHandoffPaths, saveRefineHandoff } from '../../src/refine/handoff.js';
import { refinePromptHeadless } from '../../src/refine/refiner.js';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-refine-handoff-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('refine handoff persistence', () => {
  it('saves and reloads a refined prompt for a later session', async () => {
    const outputDir = await tempDir();
    const result = refinePromptHeadless({ prompt: 'Build a PubChem sync tool', headless: true });

    const handoff = await saveRefineHandoff(outputDir, result, new Date('2026-04-20T12:00:00Z'));
    const paths = refineHandoffPaths(outputDir);

    await expect(fs.readFile(paths.promptPath, 'utf8')).resolves.toContain('Build a PubChem sync tool');
    expect(handoff.refinedPromptPath).toBe(paths.promptPath);
    expect(handoff.savedAt).toBe('2026-04-20T12:00:00.000Z');

    const loaded = await loadRefineHandoff(outputDir);
    expect(loaded?.result.refinedPrompt).toBe(result.refinedPrompt);
  });

  it('returns null when no saved handoff exists', async () => {
    await expect(loadRefineHandoff(await tempDir())).resolves.toBeNull();
  });
});
