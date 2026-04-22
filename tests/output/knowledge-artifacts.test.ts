import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { saveTaskKnowledgeArtifacts } from '../../src/output/knowledge-artifacts.js';
import type { StepResult } from '../../src/types/dag.js';

describe('task knowledge artifacts', () => {
  it('writes goal and progress knowledge files from goal/knowledge agent outputs', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-knowledge-artifacts-'));
    const steps: StepResult[] = [
      {
        id: 'step-1',
        agent: 'goal-synthesizer',
        task: 'Clarify the goal',
        status: 'completed',
        output: '# Goal Understanding\n\n## Definition of done\n- Tests pass',
      },
      {
        id: 'step-2',
        agent: 'project-knowledge-curator',
        task: 'Update project memory',
        status: 'completed',
        output: '# Project Knowledge Update\n\nImplementation wrote fixture records.',
      },
    ];

    const files = await saveTaskKnowledgeArtifacts({ outputDir, steps, pipelineId: 'v2-test' });

    expect(files.map((file) => path.relative(outputDir, file))).toEqual([
      path.join('knowledge', 'goal.md'),
      path.join('knowledge', 'progress-log.md'),
    ]);
    await expect(fs.readFile(path.join(outputDir, 'knowledge', 'goal.md'), 'utf8'))
      .resolves.toContain('Definition of done');
    await expect(fs.readFile(path.join(outputDir, 'knowledge', 'progress-log.md'), 'utf8'))
      .resolves.toContain('Implementation wrote fixture records');

    await fs.rm(outputDir, { recursive: true, force: true });
  });
});
