import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMarkdownRunDir,
  saveFinalReportMarkdown,
  saveStepMarkdown,
  saveStageMarkdown,
} from '../../src/output/markdown-artifacts.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-md-artifacts-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('markdown artifacts', () => {
  it('builds a run directory under the selected output root', () => {
    expect(buildMarkdownRunDir('/tmp/out', 'pipe-123')).toBe(
      path.join('/tmp/out', 'map-output', 'pipe-123'),
    );
  });

  it('saves stage output as sanitized markdown', async () => {
    const outputRoot = await makeTempDir();

    const file = await saveStageMarkdown({
      outputRoot,
      pipelineId: 'pipe-1',
      iteration: 2,
      stage: 'Spec QA',
      title: 'QA Output',
      content: 'QA_RESULT: pass',
    });

    expect(path.relative(outputRoot, file)).toBe(
      path.join('map-output', 'pipe-1', 'iter-2-spec-qa.md'),
    );
    await expect(fs.readFile(file, 'utf8')).resolves.toContain('QA_RESULT: pass');
  });

  it('saves step output with order and agent in the filename', async () => {
    const outputRoot = await makeTempDir();

    const file = await saveStepMarkdown({
      outputRoot,
      pipelineId: 'pipe-2',
      order: 3,
      stepId: 'write-report',
      agent: 'Researcher Agent',
      task: 'Write report',
      status: 'completed',
      content: '# Report',
    });

    expect(path.relative(outputRoot, file)).toBe(
      path.join('map-output', 'pipe-2', 'step-03-researcher-agent-write-report.md'),
    );
    const saved = await fs.readFile(file, 'utf8');
    expect(saved).toContain('# Write report');
    expect(saved).toContain('Agent: Researcher Agent');
    expect(saved).toContain('# Report');
  });

  it('saves a final report with graph, generated content, and file list', async () => {
    const outputRoot = await makeTempDir();

    const file = await saveFinalReportMarkdown({
      outputRoot,
      pipelineId: 'pipe-3',
      title: 'Generated Report',
      executionGraph: [
        {
          id: 'step-1',
          agent: 'researcher',
          provider: 'ollama',
          model: 'gemma4:26b',
          task: 'Research',
          status: 'completed',
          duration: 1200,
          dependsOn: [],
        },
        {
          id: 'step-2',
          agent: 'writer',
          provider: 'claude',
          model: 'sonnet',
          task: 'Write',
          status: 'completed',
          duration: 800,
          dependsOn: ['step-1'],
        },
      ],
      content: 'Final answer',
      filesCreated: ['src/index.ts'],
      rawLogPath: '/tmp/raw.log',
    });

    const saved = await fs.readFile(file, 'utf8');
    expect(saved).toContain('# Generated Report');
    expect(saved).toContain('step-1 -> step-2');
    expect(saved).toContain('1. step-1 [researcher | ollama/gemma4:26b] completed 1.2s');
    expect(saved).toContain('Final answer');
    expect(saved).toContain('src/index.ts');
    expect(saved).toContain('/tmp/raw.log');
  });
});
