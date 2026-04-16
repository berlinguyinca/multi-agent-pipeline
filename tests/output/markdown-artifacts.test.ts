import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMarkdownRunDir,
  generateAgentSummary,
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
      consensusDiagnostics: [{
        source: 'router',
        method: 'majority',
        runs: 3,
        selectedModel: 'gemma4',
        participants: [
          { run: 1, provider: 'ollama', model: 'gemma4', status: 'contributed', contribution: 1 },
          { run: 2, provider: 'ollama', model: 'qwen3', status: 'contributed', contribution: 1 },
        ],
      }],
    });

    const saved = await fs.readFile(file, 'utf8');
    expect(saved).toContain('# Generated Report');
    expect(saved).toContain('step-1 -> step-2');
    expect(saved).toContain('1. step-1 [researcher | ollama/gemma4:26b] completed 1.2s');
    expect(saved).toContain('Final answer');
    expect(saved).toContain('## Consensus diagnostics');
    expect(saved).toContain('router: majority, selected gemma4');
    expect(saved).toContain('ollama/qwen3 run 2: contributed 100%');
    expect(saved).toContain('src/index.ts');
    expect(saved).toContain('/tmp/raw.log');
  });


  it('removes terminal cursor rewrite escapes from step and final report markdown', async () => {
    const outputRoot = await makeTempDir();
    const noisy = [
      String.raw`The primary mission of the Researcher Agent is to generate accurate, eviden\e[6D\e[Kevidence-based conclusions.`,
      'The mandate extends beyond simple information summarization; the agent is d\u001b[1D\u001b[Kdesigned to synthesize.',
    ].join('\n');

    const stepFile = await saveStepMarkdown({
      outputRoot,
      pipelineId: 'pipe-escapes',
      order: 1,
      stepId: 'research',
      agent: 'researcher',
      task: 'Research',
      status: 'completed',
      content: noisy,
    });
    const finalFile = await saveFinalReportMarkdown({
      outputRoot,
      pipelineId: 'pipe-escapes',
      title: 'Generated Report',
      executionGraph: [],
      content: noisy,
    });

    const stepSaved = await fs.readFile(stepFile, 'utf8');
    const finalSaved = await fs.readFile(finalFile, 'utf8');
    expect(stepSaved).not.toContain(String.raw`\e[`);
    expect(finalSaved).not.toContain(String.raw`\e[`);
    expect(stepSaved).toContain('evidence-based conclusions');
    expect(finalSaved).toContain('evidence-based conclusions');
    expect(stepSaved).toContain('designed to synthesize');
    expect(finalSaved).toContain('designed to synthesize');
  });

  it('generates an agent summary markdown report', async () => {
    const outputRoot = await makeTempDir();

    const file = await generateAgentSummary({
      outputRoot,
      pipelineId: 'pipe-4',
      duration: 1500,
      success: false,
      steps: [
        {
          id: 'step-1',
          agent: 'researcher',
          provider: 'ollama',
          model: 'gemma4:26b',
          task: 'Research topic',
          status: 'completed',
          duration: 900,
        },
        {
          id: 'step-2',
          agent: 'writer',
          provider: 'claude',
          model: 'sonnet',
          task: 'Draft summary',
          status: 'failed',
          duration: 600,
          error: 'Model response was empty',
        },
      ],
    });

    const saved = await fs.readFile(file, 'utf8');
    expect(path.basename(file)).toBe('AGENTS_SUMMARY.md');
    expect(saved).toContain('# Pipeline Execution Summary');
    expect(saved).toContain('**Pipeline ID:** pipe-4');
    expect(saved).toContain('### researcher');
    expect(saved).toContain('**Status:** fully successful');
    expect(saved).toContain('### writer');
    expect(saved).toContain('**Status:** had failures');
    expect(saved).toContain('Model response was empty');
  });

  it('formats hour-long agent summary durations correctly', async () => {
    const outputRoot = await makeTempDir();

    const file = await generateAgentSummary({
      outputRoot,
      pipelineId: 'pipe-hours',
      duration: 3_600_000,
      success: true,
      steps: [],
    });

    const saved = await fs.readFile(file, 'utf8');
    expect(saved).toContain('**Duration:** 1.00h');
  });
});
