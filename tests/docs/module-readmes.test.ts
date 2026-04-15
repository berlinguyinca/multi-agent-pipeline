import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REQUIRED_README_DIRS = [
  'src/adapters',
  'src/agents',
  'src/checkpoint',
  'src/cli',
  'src/config',
  'src/github',
  'src/headless',
  'src/orchestrator',
  'src/output',
  'src/pipeline',
  'src/prompts',
  'src/router',
  'src/security',
  'src/tools',
  'src/tui',
  'src/types',
  'src/utils',
] as const;

describe('module README coverage', () => {
  it('provides a README for every top-level subsystem', async () => {
    for (const dir of REQUIRED_README_DIRS) {
      await expect(fs.access(path.join(process.cwd(), dir, 'README.md'))).resolves.toBeUndefined();
    }
  });
});
