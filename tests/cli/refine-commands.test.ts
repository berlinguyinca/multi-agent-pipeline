import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleRefineCommand } from '../../src/cli/refine-commands.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-refine-command-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('refine command', () => {
  it('writes the refined prompt to an output file', async () => {
    const dir = await makeTempDir();
    const output = path.join(dir, 'refined.md');

    const result = await handleRefineCommand([
      '--headless',
      '--output',
      output,
      'Build something useful for this repository',
    ]);

    expect(result.outputPath).toBe(output);
    const saved = await fs.readFile(output, 'utf8');
    expect(saved).toContain('Original request');
    expect(saved).toContain('Build something useful');
  });

  it('does not leak MAP execution flag values into the refined prompt', async () => {
    const result = await handleRefineCommand([
      '--headless',
      '--router-timeout',
      '5m',
      '--output-format',
      'pdf',
      '--ouputDir',
      'pubchem',
      'Build a PubChem sync tool',
    ]);

    expect(result.inputPrompt).toBe('Build a PubChem sync tool');
    expect(result.refinedPrompt).not.toContain('5m pdf');
    expect(result.refinedPrompt).not.toContain('pubchem Build');
  });

});
