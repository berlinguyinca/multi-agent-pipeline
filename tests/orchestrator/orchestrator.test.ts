// tests/orchestrator/orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_CROSS_REVIEW_CONFIG, DEFAULT_EVIDENCE_CONFIG } from '../../src/config/defaults.js';
import { executeDAG } from '../../src/orchestrator/orchestrator.js';
import { VerboseReporter } from '../../src/utils/verbose-reporter.js';
import type { DAGPlan } from '../../src/types/dag.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AdapterConfig, AgentAdapter } from '../../src/types/adapter.js';
import type { SecurityConfig } from '../../src/security/types.js';

const execFileAsync = promisify(execFile);

function mockAdapter(output: string): AgentAdapter {
  return {
    type: 'claude',
    model: undefined,
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run() {
      yield output;
    },
  };
}

function createQueueAdapter(outputs: string[]) {
  return vi.fn((): AgentAdapter => ({
    type: 'ollama',
    model: 'test-model',
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run() {
      yield outputs.shift() ?? '';
    },
  }));
}

function createCapturingQueueAdapter(outputs: string[], prompts: string[]) {
  return vi.fn((): AgentAdapter => ({
    type: 'ollama',
    model: 'test-model',
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run(prompt: string) {
      prompts.push(prompt);
      yield outputs.shift() ?? '';
    },
  }));
}

function makeAgent(name: string, outputType: 'answer' | 'data' | 'files' = 'answer'): AgentDefinition {
  return {
    name,
    description: `${name} agent`,
    adapter: 'claude',
    prompt: `You are ${name}.`,
    pipeline: [{ name: 'run' }],
    handles: name,
    output: { type: outputType },
    tools: [],
  };
}

const securityConfig: SecurityConfig = {
  enabled: true,
  maxRemediationRetries: 2,
  adapter: 'ollama',
  model: 'gemma4:26b',
  staticPatternsEnabled: true,
  llmReviewEnabled: false,
};

describe('executeDAG', () => {
  it('executes a single-step DAG', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Research result'));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].output).toBe('Research result');
    expect(result.steps[0].outputType).toBe('answer');
  });


  it('normalizes terminal cursor rewrite escapes in step output before returning results', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter([
      String.raw`Emerging Technology Research: Investigating fields (e.g., \e[K`,
      String.raw`up-t\e[4D\e[Kup-to-date web and knowledge searches.`,
    ].join('\n')));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.steps[0].output).not.toContain(String.raw`\e[`);
    expect(result.steps[0].output).toContain('Emerging Technology Research: Investigating fields (e.g.,');
    expect(result.steps[0].output).toContain('up-to-date web and knowledge searches.');
  });


  it('reports completed step output to verbose reporter for live inspection', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Research result details'));
    const reporter = {
      dagStepStart: vi.fn(),
      dagStepComplete: vi.fn(),
      onChunk: vi.fn(),
      dagStepOutput: vi.fn(),
    };

    await executeDAG(plan, agents, createAdapter, reporter as never);

    expect(reporter.dagStepOutput).toHaveBeenCalledWith(
      'step-1',
      'researcher',
      'Research result details',
    );
  });

  it('streams raw step chunks to the optional callback', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Raw output'));
    const onOutputChunk = vi.fn();

    await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, onOutputChunk);

    expect(onOutputChunk).toHaveBeenCalledWith('step-1', 'Raw output');
  });

  it('passes configured working directory to adapter runs', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    let capturedCwd: string | undefined;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, options?: { cwd?: string }) {
        capturedCwd = options?.cwd;
        yield 'Output';
      },
    }));

    await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      workingDir: '/tmp/generated',
    });

    expect(capturedCwd).toBe('/tmp/generated');
  });

  it('runs non-file local agents multiple times and selects exact consensus', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const outputs = ['Use the stable API', 'Use the unstable API', 'Use the stable API'];
    const createAdapter = vi.fn(() => mockAdapter(outputs.shift() ?? 'missing'));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      agentConsensus: {
        enabled: true,
        runs: 3,
        outputTypes: ['answer'],
        minSimilarity: 0.35,
      },
    });

    expect(result.success).toBe(true);
    expect(createAdapter).toHaveBeenCalledTimes(3);
    expect(result.steps[0].output).toBe('Use the stable API');
    expect(result.steps[0].consensus).toMatchObject({
      enabled: true,
      runs: 3,
      candidateCount: 3,
      selectedRun: 1,
      agreement: 2 / 3,
      method: 'exact-majority',
      participants: [
        { run: 1, status: 'contributed', contribution: 1 },
        { run: 2, status: 'rejected', contribution: 0 },
        { run: 3, status: 'contributed', contribution: 1 },
      ],
    });
  });

  it('runs per-agent consensus even when global agent consensus is disabled', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Write X', dependsOn: [] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher')],
      ['writer', makeAgent('writer')],
    ]);
    const outputs = ['Stable research', 'Unstable research', 'Stable research', 'Writer once'];
    const createAdapter = vi.fn(() => mockAdapter(outputs.shift() ?? 'missing'));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      agentConsensus: {
        enabled: false,
        runs: 3,
        outputTypes: ['answer'],
        minSimilarity: 0.35,
        perAgent: {
          researcher: { enabled: true, runs: 3, outputTypes: ['answer'] },
        },
        fileOutputs: {
          enabled: false,
          runs: 3,
          isolation: 'git-worktree',
          keepWorktreesOnFailure: true,
          verificationCommands: [],
          selection: 'best-passing-minimal-diff',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(createAdapter).toHaveBeenCalledTimes(4);
    expect(result.steps.find((step) => step.id === 'step-1')?.consensus?.runs).toBe(3);
    expect(result.steps.find((step) => step.id === 'step-2')?.consensus).toBeUndefined();
  });

  it('does not repeat file-output agents during local agent consensus', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement X', dependsOn: [] }],
    };
    const agents = new Map([['implementation-coder', makeAgent('implementation-coder', 'files')]]);
    const createAdapter = vi.fn(() => mockAdapter('Created files'));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      agentConsensus: {
        enabled: true,
        runs: 3,
        outputTypes: ['answer', 'data', 'presentation'],
        minSimilarity: 0.35,
      },
    });

    expect(result.success).toBe(true);
    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(result.steps[0].output).toBe('Created files');
    expect(result.steps[0].consensus).toBeUndefined();
  });

  it('runs file-output consensus in isolated git worktrees and applies the best verified patch', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-file-consensus-'));
    await execFileAsync('git', ['init'], { cwd: workingDir });
    await execFileAsync('git', ['config', 'user.email', 'map@example.test'], { cwd: workingDir });
    await execFileAsync('git', ['config', 'user.name', 'MAP Test'], { cwd: workingDir });
    await fs.writeFile(path.join(workingDir, '.gitignore'), '.map/\n', 'utf8');
    await fs.writeFile(path.join(workingDir, 'result.txt'), 'initial\n', 'utf8');
    await fs.writeFile(
      path.join(workingDir, 'verify.mjs'),
      "import { readFileSync } from 'node:fs';\nif (readFileSync('result.txt', 'utf8') !== 'good\\n') process.exit(1);\n",
      'utf8',
    );
    await execFileAsync('git', ['add', '.'], { cwd: workingDir });
    await execFileAsync('git', ['commit', '-m', 'baseline'], { cwd: workingDir });

    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement X', dependsOn: [] }],
    };
    const agents = new Map([['implementation-coder', makeAgent('implementation-coder', 'files')]]);
    const writes = ['bad\n', 'good\n', 'also-bad\n'];
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, options?: { cwd?: string }) {
        const value = writes.shift() ?? 'missing\n';
        await fs.writeFile(path.join(options?.cwd ?? workingDir, 'result.txt'), value, 'utf8');
        yield `wrote ${value.trim()}`;
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      workingDir,
      retryDelayMs: 0,
      maxStepRetries: 0,
      agentConsensus: {
        enabled: true,
        runs: 3,
        outputTypes: ['answer', 'data', 'presentation'],
        minSimilarity: 0.35,
        fileOutputs: {
          enabled: true,
          runs: 3,
          isolation: 'git-worktree',
          keepWorktreesOnFailure: false,
          verificationCommands: ['node verify.mjs'],
          selection: 'best-passing-minimal-diff',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(createAdapter).toHaveBeenCalledTimes(3);
    await expect(fs.readFile(path.join(workingDir, 'result.txt'), 'utf8')).resolves.toBe('good\n');
    expect(result.steps[0].output).toBe('wrote good');
    expect(result.steps[0].consensus).toMatchObject({
      enabled: true,
      runs: 3,
      candidateCount: 3,
      selectedRun: 2,
      method: 'worktree-best-passing-diff',
      isolation: 'git-worktree',
    });
  });

  it('passes deterministic adapter defaults to local model runs', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const researcher = makeAgent('researcher');
    researcher.adapter = 'ollama';
    researcher.model = 'gemma4:26b';
    const agents = new Map([['researcher', researcher]]);
    const runOptions: Array<Record<string, unknown> | undefined> = [];
    const createAdapter = vi.fn(() => ({
      type: 'ollama' as const,
      model: 'gemma4:26b',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, options?: Record<string, unknown>) {
        runOptions.push(options);
        yield 'Deterministic output';
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      adapterDefaults: { ollama: { think: false, temperature: 0, seed: 42 } },
    });

    expect(result.success).toBe(true);
    expect(runOptions[0]).toMatchObject({
      think: false,
      hideThinking: true,
      temperature: 0,
      seed: 42,
    });
  });

  it('executes parallel steps concurrently', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research A', dependsOn: [] },
        { id: 'step-2', agent: 'researcher', task: 'Research B', dependsOn: [] },
      ],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Result'));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('serializes ready ollama-backed steps to avoid GPU contention', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher-a', task: 'Research A', dependsOn: [] },
        { id: 'step-2', agent: 'researcher-b', task: 'Research B', dependsOn: [] },
      ],
    };
    const agentA = makeAgent('researcher-a');
    agentA.adapter = 'ollama';
    agentA.model = 'gemma4';
    const agentB = makeAgent('researcher-b');
    agentB.adapter = 'ollama';
    agentB.model = 'gemma4:26b';
    const agents = new Map([
      ['researcher-a', agentA],
      ['researcher-b', agentB],
    ]);
    let active = 0;
    let peak = 0;
    const createAdapter = vi.fn(() => ({
      type: 'ollama' as const,
      model: 'gemma4',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        yield 'done';
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter);
    expect(result.success).toBe(true);
    expect(peak).toBe(1);
  });

  it('still runs ready remote-provider steps concurrently', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'claude-agent', task: 'Do A', dependsOn: [] },
        { id: 'step-2', agent: 'codex-agent', task: 'Do B', dependsOn: [] },
      ],
    };
    const claudeAgent = makeAgent('claude-agent');
    claudeAgent.adapter = 'claude';
    const codexAgent = makeAgent('codex-agent');
    codexAgent.adapter = 'codex';
    const agents = new Map([
      ['claude-agent', claudeAgent],
      ['codex-agent', codexAgent],
    ]);
    let active = 0;
    let peak = 0;
    const createAdapter = vi.fn((config?: { type?: string }) => ({
      type: (config?.type ?? 'claude') as 'claude' | 'codex',
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        yield 'done';
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter);
    expect(result.success).toBe(true);
    expect(peak).toBeGreaterThan(1);
  });


  it('automatically runs grammar and spelling specialist after text output and rewires downstream context', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Use polished research', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher', 'answer')],
      ['grammar-spelling-specialist', makeAgent('grammar-spelling-specialist', 'answer')],
      ['writer', makeAgent('writer', 'answer')],
    ]);
    const calls: string[] = [];
    let writerPrompt = '';
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (prompt.includes('Polish grammar, spelling, punctuation')) {
          calls.push('grammar-spelling-specialist');
          yield prompt.includes('Used polished research')
            ? 'Used polished research.'
            : 'This research has spelling mistakes.';
          return;
        }
        if (prompt.includes('Research X')) {
          calls.push('researcher');
          yield 'Ths research has speling mistakes.';
          return;
        }
        if (prompt.includes('Use polished research')) {
          calls.push('writer');
          writerPrompt = prompt;
          yield 'Used polished research';
          return;
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(true);
    expect(calls).toEqual([
      'researcher',
      'grammar-spelling-specialist',
      'writer',
      'grammar-spelling-specialist',
    ]);
    expect(result.steps.map((step) => step.id)).toEqual([
      'step-1',
      'step-1-grammar-1',
      'step-2',
      'step-2-grammar-1',
    ]);
    expect(result.steps.find((step) => step.id === 'step-1-grammar-1')?.output).toBe(
      'This research has spelling mistakes.',
    );
    expect(result.plan.plan.find((step) => step.id === 'step-2')?.dependsOn).toEqual([
      'step-1-grammar-1',
    ]);
    expect(writerPrompt).toContain('[step-1-grammar-1: grammar-spelling-specialist]');
    expect(writerPrompt).toContain('This research has spelling mistakes.');
    expect(writerPrompt).not.toContain('Ths research has speling mistakes.');
  });

  it('automatically fact-checks usage classification with a dedicated agent before downstream steps', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Use verified usage', dependsOn: ['step-1'] },
      ],
    };
    const factChecker = makeAgent('usage-classification-fact-checker', 'answer');
    factChecker.adapter = 'ollama';
    factChecker.model = 'bespoke-minicheck:7b';
    const agents = new Map([
      ['usage-classification-tree', makeAgent('usage-classification-tree', 'answer')],
      ['usage-classification-fact-checker', factChecker],
      ['writer', makeAgent('writer', 'answer')],
    ]);
    const calls: Array<{ agent: string; model?: string; prompt: string }> = [];
    const createAdapter = vi.fn((config) => ({
      type: config.type,
      model: config.model,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (prompt.includes('Fact-check the usage-classification-tree report')) {
          calls.push({ agent: 'usage-classification-fact-checker', model: config.model, prompt });
          yield 'Fact-check verdict: supported\n\nAll major claims are supported.';
          return;
        }
        if (prompt.includes('Classify usage')) {
          calls.push({ agent: 'usage-classification-tree', model: config.model, prompt });
          yield [
            '# Usage Classification Tree',
            '',
            '## Usage Commonness Ranking',
            '',
            '| Rank | Usage/application/exposure origin | Category | Commonness score | Commonness label | Commonness timeframe | Recency/currentness evidence | Evidence/caveat |',
            '| --- | --- | --- | --- | --- | --- | --- | --- |',
            '| 1 | Food additive | food | 60 | less common | current | Older food use evidence | Evidence |',
            '',
            '## Claim Evidence Ledger',
            '',
            '```json',
            JSON.stringify({
              claims: [{
                id: 'claim-1',
                claim: 'Food additive use has current commonness score 60.',
                claimType: 'commonness-score',
                confidence: 'high',
                timeframe: 'current',
                recencyStatus: 'current',
                commonnessScore: 60,
                evidence: [{
                  sourceType: 'document',
                  title: 'Older food use source',
                  publishedAt: '2010',
                  summary: 'Older evidence for food additive use.',
                  supports: 'food use',
                }],
              }],
            }),
            '```',
          ].join('\n');
          return;
        }
        if (prompt.includes('Use verified usage')) {
          calls.push({ agent: 'writer', model: config.model, prompt });
          yield 'Verified report';
          return;
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.id)).toEqual([
      'step-1',
      'step-1-fact-check-1',
      'step-2',
    ]);
    expect(calls.map((call) => call.agent)).toEqual([
      'usage-classification-tree',
      'usage-classification-fact-checker',
      'writer',
    ]);
    expect(calls.find((call) => call.agent === 'usage-classification-fact-checker')?.model).toBe('bespoke-minicheck:7b');
    expect(result.plan.plan.find((step) => step.id === 'step-2')?.dependsOn).toEqual([
      'step-1',
      'step-1-fact-check-1',
    ]);
    const writerPrompt = calls.find((call) => call.agent === 'writer')?.prompt ?? '';
    expect(writerPrompt).toContain('[step-1: usage-classification-tree]');
    expect(writerPrompt).toContain('[step-1-fact-check-1: usage-classification-fact-checker]');
  });

  it('blocks usage classification downstream when claim evidence ledger is missing', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Use verified usage', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['usage-classification-tree', makeAgent('usage-classification-tree', 'answer')],
      ['usage-classification-fact-checker', makeAgent('usage-classification-fact-checker', 'answer')],
      ['writer', makeAgent('writer', 'answer')],
    ]);
    const createAdapter = vi.fn(() => mockAdapter([
      '# Usage Classification Tree',
      '',
      '## Usage Commonness Ranking',
      '',
      '| Rank | Usage/application/exposure origin | Category | Commonness score | Commonness label | Evidence/caveat |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | Historical tonic | drug | 90 | very common | Old source |',
    ].join('\n')));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.steps.find((step) => step.id === 'step-1')).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Claim Evidence Ledger is required'),
      evidenceGate: expect.objectContaining({ checked: true, passed: false }),
    });
    expect(result.steps.find((step) => step.id === 'step-2')).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('Dependency failed: step-1'),
    });
  });

  it('rejects high commonness scores for historical usage evidence', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] }],
    };
    const agents = new Map([
      ['usage-classification-tree', makeAgent('usage-classification-tree', 'answer')],
    ]);
    const output = [
      '# Usage Classification Tree',
      '',
      '## Usage Commonness Ranking',
      '',
      '| Rank | Usage/application/exposure origin | Category | Commonness score | Commonness label | Commonness timeframe | Recency/currentness evidence | Evidence/caveat |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | Historical tonic | drug | 90 | very common | historical | Only historical evidence | Old source |',
      '',
      '## Claim Evidence Ledger',
      '',
      '```json',
      JSON.stringify({
        claims: [{
          id: 'claim-historical',
          claim: 'Historical tonic use has commonness score 90.',
          claimType: 'commonness-score',
          confidence: 'medium',
          timeframe: 'historical',
          recencyStatus: 'historical',
          commonnessScore: 90,
          evidence: [{
            sourceType: 'document',
            title: 'Historical source',
            publishedAt: '1820',
            summary: 'Historical use only.',
            supports: 'historical use',
          }],
        }],
      }),
      '```',
    ].join('\n');
    const result = await executeDAG(
      plan,
      agents,
      vi.fn(() => mockAdapter(output)),
      undefined,
      undefined,
      undefined,
      undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Historical or obsolete practices cannot receive a current commonness score above 20'),
      evidenceGate: expect.objectContaining({
        checked: true,
        passed: false,
        claims: [expect.objectContaining({ id: 'claim-historical' })],
      }),
    });
  });

  it('does not treat retrieval date alone as current prevalence evidence', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] }],
    };
    const agents = new Map([
      ['usage-classification-tree', makeAgent('usage-classification-tree', 'answer')],
    ]);
    const output = [
      '# Usage Classification Tree',
      '',
      '## Claim Evidence Ledger',
      '',
      '```json',
      JSON.stringify({
        claims: [{
          id: 'claim-stale',
          claim: 'A use with only historical support is common today.',
          claimType: 'commonness-score',
          confidence: 'medium',
          timeframe: 'current',
          recencyStatus: 'current',
          commonnessScore: 80,
          evidence: [{
            sourceType: 'url',
            title: 'Retrieved old practice page',
            retrievedAt: '2026-04-18',
            summary: 'Describes use in historical practice only.',
            supports: 'historical use',
          }],
        }],
      }),
      '```',
    ].join('\n');

    const result = await executeDAG(
      plan,
      agents,
      vi.fn(() => mockAdapter(output)),
      undefined,
      undefined,
      undefined,
      undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0].error).toContain('High commonness scores require current/recent prevalence evidence');
  });

  it('remediates a failing evidence ledger once before blocking downstream', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Use usage', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['usage-classification-tree', makeAgent('usage-classification-tree', 'answer')],
      ['writer', makeAgent('writer', 'answer')],
    ]);
    let usageRuns = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (prompt.includes('Use usage')) {
          yield 'writer saw remediated usage';
          return;
        }
        usageRuns += 1;
        const good = prompt.includes('Evidence Gate Remediation');
        yield [
          '# Usage Classification Tree',
          good ? 'Current supported classification.' : 'Weak classification.',
          '',
          '## Claim Evidence Ledger',
          '```json',
          JSON.stringify({
            claims: [{
              id: 'claim-1',
              claim: good ? 'Current supported classification.' : 'Weak classification.',
              claimType: 'usage-classification',
              confidence: 'high',
              timeframe: 'current',
              recencyStatus: 'current',
              evidence: good ? [{
                sourceType: 'url',
                retrievedAt: '2026-04-18',
                summary: 'direct evidence',
                supports: 'current classification',
              }] : [],
            }],
          }),
          '```',
        ].join('\n');
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        maxStepRetries: 0,
        retryDelayMs: 0,
        evidence: {
          enabled: true,
          mode: 'strict',
          requiredAgents: ['usage-classification-tree'],
          currentClaimMaxSourceAgeDays: 730,
          freshnessProfiles: {},
          requireRetrievedAtForWebClaims: true,
          blockUnsupportedCurrentClaims: true,
          remediationMaxRetries: 1,
        },
      },
    );

    expect(result.success).toBe(true);
    expect(usageRuns).toBe(2);
    expect(result.steps.find((step) => step.id === 'step-1')?.evidenceGate?.passed).toBe(true);
    expect(result.steps.find((step) => step.id === 'step-2')?.status).toBe('completed');
  });

  it('explains evidence remediation retries instead of reporting unknown', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'classyfire-taxonomy-classifier', task: 'Classify taxonomy', dependsOn: [] }],
    };
    const agent = makeAgent('classyfire-taxonomy-classifier', 'answer');
    const agents = new Map([
      ['classyfire-taxonomy-classifier', agent],
    ]);
    const reporter = {
      dagStepStart: vi.fn(),
      dagStepComplete: vi.fn(),
      dagStepOutput: vi.fn(),
      dagStepRetry: vi.fn(),
      onChunk: vi.fn(),
    };
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        const remediated = prompt.includes('Evidence Gate Remediation');
        yield [
          '# ClassyFire / ChemOnt Taxonomic Classification',
          remediated ? 'Medium-confidence taxonomy.' : 'High-confidence taxonomy.',
          '',
          '## Claim Evidence Ledger',
          '```json',
          JSON.stringify({
            claims: [{
              id: 'tax-1',
              claim: remediated ? 'Medium-confidence taxonomy.' : 'High-confidence taxonomy.',
              claimType: 'chemical-taxonomy',
              confidence: remediated ? 'medium' : 'high',
              evidence: [{
                sourceType: 'model-prior',
                summary: 'model memory only',
                supports: 'taxonomy',
              }],
            }],
          }),
          '```',
        ].join('\n');
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      reporter as never,
      undefined,
      undefined,
      undefined,
      {
        maxStepRetries: 0,
        retryDelayMs: 0,
        evidence: {
          enabled: true,
          mode: 'strict',
          requiredAgents: ['classyfire-taxonomy-classifier'],
          currentClaimMaxSourceAgeDays: 730,
          freshnessProfiles: {},
          requireRetrievedAtForWebClaims: true,
          blockUnsupportedCurrentClaims: true,
          remediationMaxRetries: 1,
        },
      },
    );

    expect(result.success).toBe(true);
    expect(reporter.dagStepRetry).toHaveBeenCalledWith(
      'step-1',
      'classyfire-taxonomy-classifier',
      1,
      expect.stringContaining('tax-1: High-confidence claims cannot be supported only by model-prior evidence.'),
    );
    expect(reporter.dagStepRetry).not.toHaveBeenCalledWith(
      'step-1',
      'classyfire-taxonomy-classifier',
      1,
      'unknown',
    );
  });

  it('routes persistent evidence-gate failures through an evidence feedback step before retrying downstream work', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'usage-classification-tree', task: 'Classify current usage commonness', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Use verified usage', dependsOn: ['step-1'] },
      ],
    };
    const usageAgent = makeAgent('usage-classification-tree', 'answer');
    usageAgent.model = 'usage-model';
    const researcher = makeAgent('researcher', 'answer');
    researcher.model = 'research-model';
    const writer = makeAgent('writer', 'answer');
    writer.model = 'writer-model';
    const agents = new Map([
      ['usage-classification-tree', usageAgent],
      ['researcher', researcher],
      ['writer', writer],
    ]);
    let usageRuns = 0;
    let researcherRuns = 0;

    const createAdapter = vi.fn((config?: { model?: string }) => ({
      type: 'claude' as const,
      model: config?.model,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (config?.model === 'research-model') {
          researcherRuns += 1;
          expect(prompt).toContain('Evidence feedback router loop');
          yield [
            '# Evidence Feedback',
            '- Current/recent prevalence evidence found for the requested usage context.',
            '- Use `sourceType: "url"`, `retrievedAt: "2026-04-18"`, and supports text that mentions current prevalence.',
          ].join('\n');
          return;
        }
        if (config?.model === 'writer-model') {
          expect(prompt).toContain('[step-1-retry-1: usage-classification-tree]');
          yield 'writer used verified usage';
          return;
        }
        usageRuns += 1;
        const sawEvidenceFeedback = prompt.includes('[step-1-evidence-feedback-1: researcher]');
        yield [
          '# Usage Classification Tree',
          sawEvidenceFeedback ? 'Current supported commonness.' : 'Unsupported high commonness.',
          '',
          '## Claim Evidence Ledger',
          '```json',
          JSON.stringify({
            claims: [{
              id: 'claim-1',
              claim: sawEvidenceFeedback ? 'Current supported commonness.' : 'Unsupported high commonness.',
              claimType: 'commonness-score',
              confidence: sawEvidenceFeedback ? 'medium' : 'high',
              timeframe: 'current',
              recencyStatus: 'current',
              commonnessScore: 80,
              evidence: sawEvidenceFeedback ? [{
                sourceType: 'url',
                retrievedAt: '2026-04-18',
                summary: 'current prevalence evidence',
                supports: 'current prevalence for the requested usage context',
              }] : [{
                sourceType: 'model-prior',
                summary: 'model memory only',
                supports: 'unsupported broad commonness',
              }],
            }],
          }),
          '```',
        ].join('\n');
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        maxStepRetries: 0,
        retryDelayMs: 0,
        evidence: {
          enabled: true,
          mode: 'strict',
          requiredAgents: ['usage-classification-tree'],
          currentClaimMaxSourceAgeDays: 730,
          freshnessProfiles: {},
          requireRetrievedAtForWebClaims: true,
          blockUnsupportedCurrentClaims: true,
          remediationMaxRetries: 1,
        },
      },
    );

    expect(result.success).toBe(true);
    expect(usageRuns).toBe(3);
    expect(researcherRuns).toBe(1);
    expect(result.steps.map((step) => step.id)).toEqual(
      expect.arrayContaining(['step-1', 'step-1-evidence-feedback-1', 'step-1-retry-1', 'step-2']),
    );
    expect(result.steps.find((step) => step.id === 'step-1')).toMatchObject({
      status: 'recovered',
      failureKind: 'evidence',
      replacementStepId: 'step-1-retry-1',
    });
    expect(result.steps.find((step) => step.id === 'step-1-evidence-feedback-1')).toMatchObject({
      agent: 'researcher',
      status: 'completed',
      edgeType: 'feedback',
      spawnedByAgent: 'usage-classification-tree',
    });
    expect(result.steps.find((step) => step.id === 'step-1-retry-1')).toMatchObject({
      status: 'completed',
      dependsOn: ['step-1-evidence-feedback-1'],
      edgeType: 'feedback',
    });
    expect(result.plan.plan.find((step) => step.id === 'step-2')?.dependsOn).toEqual(['step-1-retry-1']);
  });

  it('does not evidence-gate feedback helper output before retry validation', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'usage-classification-tree', task: 'Classify current usage commonness', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Use verified usage', dependsOn: ['step-1'] },
      ],
    };
    const usageAgent = makeAgent('usage-classification-tree', 'answer');
    usageAgent.model = 'usage-model';
    const researcher = makeAgent('researcher', 'answer');
    researcher.model = 'research-model';
    const writer = makeAgent('writer', 'answer');
    writer.model = 'writer-model';
    const agents = new Map([
      ['usage-classification-tree', usageAgent],
      ['researcher', researcher],
      ['writer', writer],
    ]);

    const createAdapter = vi.fn((config?: { model?: string }) => ({
      type: 'claude' as const,
      model: config?.model,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (config?.model === 'research-model') {
          yield 'Found current source: use sourceType url with retrievedAt 2026-04-18 and supports current prevalence.';
          return;
        }
        if (config?.model === 'writer-model') {
          yield 'writer used verified usage';
          return;
        }
        const sawEvidenceFeedback = prompt.includes('[step-1-evidence-feedback-1: researcher]');
        yield [
          '# Usage Classification Tree',
          sawEvidenceFeedback ? 'Current supported commonness.' : 'Unsupported high commonness.',
          '',
          '## Claim Evidence Ledger',
          '```json',
          JSON.stringify({
            claims: [{
              id: 'claim-1',
              claim: sawEvidenceFeedback ? 'Current supported commonness.' : 'Unsupported high commonness.',
              claimType: 'commonness-score',
              confidence: sawEvidenceFeedback ? 'medium' : 'high',
              timeframe: 'current',
              recencyStatus: 'current',
              commonnessScore: 80,
              evidence: sawEvidenceFeedback ? [{
                sourceType: 'url',
                retrievedAt: '2026-04-18',
                summary: 'current prevalence evidence',
                supports: 'current prevalence for the requested usage context',
              }] : [{
                sourceType: 'model-prior',
                summary: 'model memory only',
                supports: 'unsupported broad commonness',
              }],
            }],
          }),
          '```',
        ].join('\n');
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        maxStepRetries: 0,
        retryDelayMs: 0,
        evidence: {
          enabled: true,
          mode: 'strict',
          requiredAgents: ['usage-classification-tree', 'researcher'],
          currentClaimMaxSourceAgeDays: 730,
          freshnessProfiles: {},
          requireRetrievedAtForWebClaims: true,
          blockUnsupportedCurrentClaims: true,
          remediationMaxRetries: 1,
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.steps.find((step) => step.id === 'step-1-evidence-feedback-1')).toMatchObject({
      agent: 'researcher',
      status: 'completed',
      edgeType: 'feedback',
      evidenceGate: expect.objectContaining({ checked: false, passed: true }),
    });
    expect(result.steps.find((step) => step.id === 'step-1-retry-1')?.status).toBe('completed');
    expect(result.steps.find((step) => step.id === 'step-2')?.status).toBe('completed');
  });

  it('reports evidence feedback recovery scheduling to verbose reporter', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] }],
    };
    const usageAgent = makeAgent('usage-classification-tree', 'answer');
    usageAgent.model = 'usage-model';
    const researcher = makeAgent('researcher', 'answer');
    researcher.model = 'research-model';
    const agents = new Map([
      ['usage-classification-tree', usageAgent],
      ['researcher', researcher],
    ]);
    const reporter = {
      dagStepStart: vi.fn(),
      dagStepComplete: vi.fn(),
      dagStepOutput: vi.fn(),
      dagStepRetry: vi.fn(),
      dagRecoveryScheduled: vi.fn(),
      onChunk: vi.fn(),
    };
    const createAdapter = vi.fn((config?: { model?: string }) => ({
      type: 'claude' as const,
      model: config?.model,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (config?.model === 'research-model') {
          yield 'Evidence helper output';
          return;
        }
        const sawEvidenceFeedback = prompt.includes('Evidence helper output');
        yield [
          '# Usage Classification Tree',
          '',
          '## Claim Evidence Ledger',
          '```json',
          JSON.stringify({
            claims: [{
              id: 'claim-1',
              claim: 'Usage claim.',
              claimType: 'usage-classification',
              confidence: sawEvidenceFeedback ? 'medium' : 'high',
              timeframe: 'current',
              recencyStatus: 'current',
              evidence: sawEvidenceFeedback ? [{
                sourceType: 'url',
                retrievedAt: '2026-04-18',
                summary: 'current evidence',
                supports: 'current usage',
              }] : [],
            }],
          }),
          '```',
        ].join('\n');
      },
    }));

    await executeDAG(
      plan,
      agents,
      createAdapter,
      reporter as never,
      undefined,
      undefined,
      undefined,
      {
        maxStepRetries: 0,
        retryDelayMs: 0,
        evidence: {
          enabled: true,
          mode: 'strict',
          requiredAgents: ['usage-classification-tree'],
          currentClaimMaxSourceAgeDays: 730,
          freshnessProfiles: {},
          requireRetrievedAtForWebClaims: true,
          blockUnsupportedCurrentClaims: true,
          remediationMaxRetries: 1,
        },
      },
    );

    expect(reporter.dagRecoveryScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        failedStepId: 'step-1',
        helperStepId: 'step-1-evidence-feedback-1',
        helperAgent: 'researcher',
        retryStepId: 'step-1-retry-1',
        failureKind: 'evidence',
        reason: expect.stringContaining('Supported claims must include'),
      }),
    );
  });

  it('automatically fact-checks researcher output before downstream use', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research evidence', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Use verified research', dependsOn: ['step-1'] },
      ],
    };
    const researchFactChecker = makeAgent('research-fact-checker', 'answer');
    researchFactChecker.adapter = 'ollama';
    researchFactChecker.model = 'bespoke-minicheck:7b';
    const agents = new Map([
      ['researcher', makeAgent('researcher', 'answer')],
      ['research-fact-checker', researchFactChecker],
      ['grammar-spelling-specialist', makeAgent('grammar-spelling-specialist', 'answer')],
      ['writer', makeAgent('writer', 'answer')],
    ]);
    const calls: Array<{ agent: string; model?: string; prompt: string }> = [];
    const createAdapter = vi.fn((config) => ({
      type: config.type,
      model: config.model,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (prompt.includes('Fact-check the researcher report')) {
          calls.push({ agent: 'research-fact-checker', model: config.model, prompt });
          yield 'Fact-check verdict: supported\n\nClaims are supported.';
          return;
        }
        if (prompt.includes('Polish grammar, spelling, punctuation')) {
          calls.push({ agent: 'grammar-spelling-specialist', model: config.model, prompt });
          yield 'Research output polished.';
          return;
        }
        if (prompt.includes('Research evidence')) {
          calls.push({ agent: 'researcher', model: config.model, prompt });
          yield 'Research output with suported claim.';
          return;
        }
        if (prompt.includes('Use verified research')) {
          calls.push({ agent: 'writer', model: config.model, prompt });
          yield 'Verified research report';
          return;
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.id)).toEqual([
      'step-1',
      'step-1-grammar-1',
      'step-1-fact-check-1',
      'step-2',
      'step-2-grammar-1',
    ]);
    expect(calls.find((call) => call.agent === 'research-fact-checker')?.model).toBe('bespoke-minicheck:7b');
    expect(result.plan.plan.find((step) => step.id === 'step-2')?.dependsOn).toEqual([
      'step-1-grammar-1',
      'step-1-fact-check-1',
    ]);
    const writerPrompt = calls.find((call) => call.agent === 'writer')?.prompt ?? '';
    expect(writerPrompt).toContain('[step-1-grammar-1: grammar-spelling-specialist]');
    expect(writerPrompt).toContain('[step-1-fact-check-1: research-fact-checker]');
  });

  it('blocks downstream usage consumers when the usage fact-checker rejects the report', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Use verified usage', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['usage-classification-tree', makeAgent('usage-classification-tree', 'answer')],
      ['usage-classification-fact-checker', makeAgent('usage-classification-fact-checker', 'answer')],
      ['writer', makeAgent('writer', 'answer')],
    ]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (prompt.includes('Fact-check the usage-classification-tree report')) {
          yield 'Fact-check verdict: rejected\n\nUnsupported therapeutic use claim.';
          return;
        }
        if (prompt.includes('Classify usage')) {
          yield [
            '# Usage Classification Tree',
            '',
            'Claim: unsupported use',
            '',
            '## Claim Evidence Ledger',
            '',
            '```json',
            JSON.stringify({
              claims: [{
                id: 'claim-1',
                claim: 'Unsupported use has low current commonness.',
                claimType: 'commonness-score',
                confidence: 'medium',
                timeframe: 'current',
                recencyStatus: 'current',
                commonnessScore: 40,
                evidence: [{
                  sourceType: 'document',
                  title: 'Stale source',
                  publishedAt: '2010',
                  summary: 'Stale but present evidence so fact-checker can adjudicate.',
                  supports: 'older usage claim',
                }],
              }],
            }),
            '```',
          ].join('\n');
          return;
        }
        if (prompt.includes('Use verified usage')) {
          yield 'should not run';
          return;
        }
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.steps.find((step) => step.id === 'step-1-fact-check-1')).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Fact-checker rejected'),
    });
    expect(result.steps.find((step) => step.id === 'step-2')).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('Dependency failed: step-1-fact-check-1'),
    });
  });

  it('does not run grammar polishing on structured Markdown reports', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'result-judge', task: 'Judge report', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Use report', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['result-judge', makeAgent('result-judge', 'answer')],
      ['grammar-spelling-specialist', makeAgent('grammar-spelling-specialist', 'answer')],
      ['writer', makeAgent('writer', 'answer')],
    ]);
    const calls: string[] = [];
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (prompt.includes('Polish grammar, spelling, punctuation')) {
          calls.push('grammar-spelling-specialist');
          yield 'should not run';
          return;
        }
        if (prompt.includes('Judge report')) {
          calls.push('result-judge');
          yield '# Report\n\n| Criterion | Description |\n| --- | --- |\n| Accuracy | Preserve ChemOnt labels. |\n\n- Keep C17H21NO4.';
          return;
        }
        if (prompt.includes('Use report')) {
          calls.push('writer');
          yield 'Final';
          return;
        }
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(true);
    expect(calls).toEqual(['result-judge', 'writer', 'grammar-spelling-specialist']);
    expect(result.plan.plan.find((step) => step.id === 'step-2')?.dependsOn).toEqual(['step-1']);
  });


  it('blocks dependent steps when handoff validation fails', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] },
        { id: 'step-2', agent: 'writer', task: 'Write X', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher', 'answer')],
      ['writer', makeAgent('writer', 'answer')],
    ]);
    const createAdapter = vi.fn(() => mockAdapter(''));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(false);
    expect(result.steps.find((step) => step.id === 'step-1')).toMatchObject({
      status: 'failed',
      handoffPassed: false,
    });
    expect(result.steps.find((step) => step.id === 'step-2')).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('step-1'),
    });
  });

  it('records spec conformance metadata on implementation-like steps', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement', dependsOn: [] }],
    };
    const agents = new Map([
      ['implementation-coder', makeAgent('implementation-coder', 'files')],
    ]);
    const createAdapter = vi.fn(() => mockAdapter('Implemented login only.'));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        handoffValidation: {
          reviewedSpecContent: '# Spec\n\n- [ ] User can export CSV reports',
        },
      },
    );

    expect(result.steps[0].specConformance).toMatchObject({
      checked: true,
      passed: false,
      missingCriteria: ['User can export CSV reports'],
    });
    expect(result.steps[0].handoffPassed).toBe(true);
  });


  it('does not run grammar polishing after output-formatter terminal output', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'output-formatter', task: 'Format final XLS text', dependsOn: [] }],
    };
    const agents = new Map([
      ['output-formatter', makeAgent('output-formatter', 'answer')],
      ['grammar-spelling-specialist', makeAgent('grammar-spelling-specialist', 'answer')],
    ]);
    const createAdapter = vi.fn(() => mockAdapter('Entity,Usage Domain\nAlanine,biomarker'));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.id)).toEqual(['step-1']);
  });

  it('passes dependency output as context', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build X', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher')],
      ['coder', makeAgent('coder', 'files')],
    ]);
    let capturedPrompt = '';
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        capturedPrompt = prompt;
        yield 'Output';
      },
    }));

    await executeDAG(plan, agents, createAdapter);

    // The second step should receive context from the first and preserve lineage metadata.
    expect(capturedPrompt).toContain('Build X');
    expect(capturedPrompt).toContain('step-1');
    const result = await executeDAG(plan, agents, createAdapter);
    expect(result.steps.find((step) => step.id === 'step-2')?.dependsOn).toEqual(['step-1']);
  });

  it('skips steps when dependency fails', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build X', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher')],
      ['coder', makeAgent('coder', 'files')],
    ]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        throw new Error('Adapter failed');
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[1].status).toBe('skipped');
    expect(result.steps[1].reason).toContain('step-1');
  });

  it('injects agent system prompt and tool catalog into step context', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'coder', task: 'Build X', dependsOn: [] }],
    };
    const coderAgent = makeAgent('coder', 'files');
    coderAgent.prompt = 'You are a coding expert.';
    coderAgent.tools = [{ type: 'builtin', name: 'shell' }];
    const agents = new Map([['coder', coderAgent]]);

    let capturedPrompt = '';
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        capturedPrompt = prompt;
        yield 'Output';
      },
    }));

    await executeDAG(plan, agents, createAdapter);

    expect(capturedPrompt).toContain('You are a coding expert');
    expect(capturedPrompt).toContain('shell');
    expect(capturedPrompt).toContain('Build X');
  });

  it('reports partial success', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build', dependsOn: [] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher')],
      ['coder', makeAgent('coder', 'files')],
    ]);
    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        callCount += 1;
        if (callCount === 1) yield 'Success';
        else throw new Error('Failed');
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(false);
    const completed = result.steps.filter((s) => s.status === 'completed');
    const failed = result.steps.filter((s) => s.status === 'failed');
    expect(completed).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });

  it('reruns gated file output with security findings until it is fixed', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'coder', task: 'Build X', dependsOn: [] }],
    };
    const agents = new Map([['coder', makeAgent('coder', 'files')]]);
    const prompts: string[] = [];
    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        prompts.push(prompt);
        callCount += 1;
        yield callCount === 1 ? 'eval(userInput);' : 'const value = Number(userInput);';
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      { config: securityConfig },
      undefined,
      undefined,
      { retryDelayMs: 0 },
    );

    expect(result.success).toBe(true);
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].securityPassed).toBe(true);
    expect(result.steps[0].attempts).toBe(2);
    expect(prompts[1]).toContain('Security remediation required before this step can be accepted.');
    expect(prompts[1]).toContain('eval-injection');
  });

  it('fails gated file output when the remediation budget is exhausted', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'coder', task: 'Build X', dependsOn: [] }],
    };
    const agents = new Map([['coder', makeAgent('coder', 'files')]]);
    const createAdapter = vi.fn(() => mockAdapter('eval(userInput);'));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      { config: { ...securityConfig, maxRemediationRetries: 0 } },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].securityPassed).toBe(false);
    expect(result.steps[0].error).toContain('Security gate');
  });

  it('retries a failed step up to maxStepRetries', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        callCount += 1;
        if (callCount < 3) throw new Error('Temporary failure');
        yield 'Success on third try';
      },
    }));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 2, retryDelayMs: 0 },
    );

    expect(result.success).toBe(true);
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].output).toBe('Success on third try');
    expect(result.steps[0].attempts).toBe(3);
  });

  it('fails after exhausting retries', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        throw new Error('Persistent failure');
      },
    }));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 1, retryDelayMs: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error).toBe('Persistent failure');
    expect(result.steps[0].attempts).toBe(2);
  });

  it('does not retry non-retryable errors', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'coder', task: 'Build X', dependsOn: [] }],
    };
    const agents = new Map([['coder', makeAgent('coder', 'files')]]);
    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        callCount += 1;
        throw new Error('Execution cancelled');
      },
    }));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 3, retryDelayMs: 0 },
    );

    expect(result.success).toBe(false);
    expect(callCount).toBe(1);
    expect(result.steps[0].attempts).toBe(1);
  });

  it('applies per-step timeout via stepTimeoutMs', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-step-timeout-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: { signal?: AbortSignal }) {
        // Hang until aborted
        await new Promise<void>((resolve) => {
          opts?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new Error('Step timed out');
      },
    }));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { stepTimeoutMs: 50, maxStepRetries: 0, retryDelayMs: 0, workingDir },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
  });

  it('reports a specific step timeout message when a step aborts', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-step-timeout-message-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: { signal?: AbortSignal }) {
        await new Promise<void>((resolve) => {
          opts?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        const err = new Error('This operation was aborted.');
        (err as Error & { name: string }).name = 'AbortError';
        throw err;
      },
    }));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { stepTimeoutMs: 10, maxStepRetries: 0, retryDelayMs: 0, workingDir },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0].error).toContain('Step timed out during step-1 (researcher)');
  });

  it('reports attempts as 1 when no retries configured', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Result'));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.steps[0].attempts).toBe(1);
  });

  it('uses a bounded default retry budget for timeout failures when retry config is omitted', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-timeout-budget-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const timeoutWindows: number[] = [];
    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: { signal?: AbortSignal }) {
        callCount += 1;
        const startedAt = Date.now();
        if (callCount <= 1) {
          await new Promise<void>((resolve) => {
            opts?.signal?.addEventListener('abort', () => {
              timeoutWindows.push(Date.now() - startedAt);
              resolve();
            }, { once: true });
          });
          const err = new Error('This operation was aborted.');
          (err as Error & { name: string }).name = 'AbortError';
          throw err;
        }
        yield 'Recovered after slow model startup';
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { stepTimeoutMs: 25, retryDelayMs: 0, workingDir },
    );

    expect(result.success).toBe(true);
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].attempts).toBe(2);
    expect(timeoutWindows).toHaveLength(1);
    expect(timeoutWindows[0]).toBeGreaterThanOrEqual(20);
  });

  it('treats stepTimeoutMs as an inactivity timeout while output keeps streaming', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-inactivity-timeout-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield 'chunk 1 ';
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield 'chunk 2 ';
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield 'chunk 3';
      },
    }));

    const startedAt = Date.now();
    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { stepTimeoutMs: 15, maxStepRetries: 0, retryDelayMs: 0, workingDir },
    );

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30);
    expect(result.success).toBe(true);
    expect(result.steps[0].output).toBe('chunk 1 chunk 2 chunk 3');
  });

  it('backs off timed-out steps and remembers the successful timeout for future runs', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-adaptive-timeout-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    let firstRunCalls = 0;
    const firstRunAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: { signal?: AbortSignal }) {
        firstRunCalls += 1;
        if (firstRunCalls === 1) {
          await new Promise<void>((resolve) => {
            opts?.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          const err = new Error('This operation was aborted.');
          (err as Error & { name: string }).name = 'AbortError';
          throw err;
        }
        yield 'Recovered with a larger timeout';
      },
    }));

    const first = await executeDAG(
      plan,
      agents,
      firstRunAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { stepTimeoutMs: 20, maxStepRetries: 1, retryDelayMs: 0, workingDir },
    );

    expect(first.success).toBe(true);
    expect(first.steps[0].attempts).toBe(2);
    await expect(fs.readFile(path.join(workingDir, '.map', 'adaptive-timeouts.json'), 'utf8'))
      .resolves.toContain('"researcher": 40');

    let secondRunCalls = 0;
    const secondRunAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: { signal?: AbortSignal }) {
        secondRunCalls += 1;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 30);
          opts?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            const err = new Error('This operation was aborted.');
            (err as Error & { name: string }).name = 'AbortError';
            reject(err);
          }, { once: true });
        });
        yield 'Completed using the learned timeout';
      },
    }));

    const second = await executeDAG(
      plan,
      agents,
      secondRunAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { stepTimeoutMs: 20, maxStepRetries: 0, retryDelayMs: 0, workingDir },
    );

    expect(second.success).toBe(true);
    expect(second.steps[0].attempts).toBe(1);
    expect(secondRunCalls).toBe(1);
  });

  it('does not spawn recovery agents for timeout-only failures', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] }],
    };
    const agents = new Map([
      ['usage-classification-tree', makeAgent('usage-classification-tree')],
      ['bug-debugger', makeAgent('bug-debugger')],
    ]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: { signal?: AbortSignal }) {
        await new Promise<void>((resolve) => {
          opts?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        const err = new Error('This operation was aborted.');
        (err as Error & { name: string }).name = 'AbortError';
        throw err;
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { stepTimeoutMs: 10, maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.steps.map((step) => step.id)).toEqual(['step-1']);
    expect(result.steps[0]).toMatchObject({
      status: 'failed',
      failureKind: 'timeout',
    });
  });

  it('passes adapter-default think=false to ollama adapters', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agent = makeAgent('researcher');
    agent.adapter = 'ollama';
    agent.model = 'gemma4';
    const agents = new Map([['researcher', agent]]);
    let capturedOptions: Record<string, unknown> | undefined;
    const createAdapter = vi.fn(() => ({
      type: 'ollama' as const,
      model: 'gemma4',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: Record<string, unknown>) {
        capturedOptions = opts;
        yield 'Result';
      },
    }));

    await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 0, retryDelayMs: 0, adapterDefaults: { ollama: { think: false } } },
    );

    expect(capturedOptions?.think).toBe(false);
    expect(capturedOptions?.hideThinking).toBe(true);
  });

  it('agent-level think overrides adapter default', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agent = makeAgent('researcher');
    agent.adapter = 'ollama';
    agent.think = true; // Override the adapter default
    const agents = new Map([['researcher', agent]]);
    let capturedOptions: Record<string, unknown> | undefined;
    const createAdapter = vi.fn(() => ({
      type: 'ollama' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: Record<string, unknown>) {
        capturedOptions = opts;
        yield 'Result';
      },
    }));

    await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 0, retryDelayMs: 0, adapterDefaults: { ollama: { think: false } } },
    );

    expect(capturedOptions?.think).toBe(true);
    expect(capturedOptions?.hideThinking).toBe(false);
  });

  it('does not pass think options when no defaults and no agent override', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    let capturedOptions: Record<string, unknown> | undefined;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: Record<string, unknown>) {
        capturedOptions = opts;
        yield 'Result';
      },
    }));

    await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(capturedOptions?.think).toBeUndefined();
    expect(capturedOptions?.hideThinking).toBeUndefined();
  });

  it('does not gate answer-only steps without risky tools', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Explain X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher', 'answer')]]);
    const createAdapter = vi.fn(() => mockAdapter('eval(userInput);'));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      { config: securityConfig },
      undefined,
      undefined,
      { retryDelayMs: 0 },
    );

    expect(result.success).toBe(true);
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].securityPassed).toBeUndefined();
  });

  it('routes compile failures through a recovery helper and retry step', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Build feature', dependsOn: [] }],
    };
    const implementationAgent = makeAgent('implementation-coder', 'files');
    const buildFixer = makeAgent('build-fixer', 'files');
    const agents = new Map([
      ['implementation-coder', implementationAgent],
      ['build-fixer', buildFixer],
    ]);
    const callCount = new Map<string, number>();
    const createAdapter = vi.fn((config?: { model?: string }) => ({
      type: 'claude' as const,
      model: config?.model,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        const key = prompt.includes('Fix the failed step') ? 'build-fixer' : 'implementation-coder';
        callCount.set(key, (callCount.get(key) ?? 0) + 1);
        if (key === 'implementation-coder' && callCount.get(key) === 1) {
          throw new Error('TypeScript compile failed: cannot find name Foo');
        }
        yield key === 'build-fixer' ? 'Patched the imports' : 'Feature compiled successfully';
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.id)).toEqual(
      expect.arrayContaining(['step-1', 'step-1-recovery-1', 'step-1-retry-1']),
    );
    expect(result.steps.find((step) => step.id === 'step-1')?.status).toBe('recovered');
    expect(result.steps.find((step) => step.id === 'step-1-recovery-1')?.agent).toBe('build-fixer');
    expect(result.steps.find((step) => step.id === 'step-1-retry-1')?.status).toBe('completed');
  });

  it('uses the detected local model concurrency when scheduling ready Ollama steps', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher-a', task: 'Research A', dependsOn: [] },
        { id: 'step-2', agent: 'researcher-b', task: 'Research B', dependsOn: [] },
      ],
    };
    const agentA = makeAgent('researcher-a');
    agentA.adapter = 'ollama';
    const agentB = makeAgent('researcher-b');
    agentB.adapter = 'ollama';
    const agents = new Map([
      ['researcher-a', agentA],
      ['researcher-b', agentB],
    ]);
    let active = 0;
    let maxActive = 0;
    const createAdapter = vi.fn(() => ({
      type: 'ollama' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        yield 'Result';
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      { localModelConcurrency: 2, retryDelayMs: 0 },
    );

    expect(result.success).toBe(true);
    expect(maxActive).toBe(2);
  });


  it('lets adviser refresh agents and replace pending downstream steps with a revised workflow', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'spec-qa-reviewer', task: 'Approve spec', dependsOn: [] },
        { id: 'step-2', agent: 'adviser', task: 'Advise workflow', dependsOn: ['step-1'] },
        { id: 'step-3', agent: 'implementation-coder', task: 'Generic implementation', dependsOn: ['step-2'] },
      ],
    };
    const agents = new Map([
      ['spec-qa-reviewer', makeAgent('spec-qa-reviewer')],
      ['adviser', makeAgent('adviser')],
      ['implementation-coder', makeAgent('implementation-coder', 'files')],
    ]);
    const refreshedAgents = new Map([
      ...agents,
      ['migration-specialist', makeAgent('migration-specialist', 'files')],
    ]);
    const calls: string[] = [];
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (prompt.includes('Approve spec')) {
          calls.push('spec-qa-reviewer');
          yield 'Spec QA approved';
          return;
        }
        if (prompt.includes('Advise workflow')) {
          calls.push('adviser');
          yield JSON.stringify({
            kind: 'adviser-workflow',
            refreshAgents: true,
            plan: [
              { id: 'step-3a', agent: 'migration-specialist', task: 'Apply the schema migration', dependsOn: ['step-2'] },
              { id: 'step-4', agent: 'implementation-coder', task: 'Implement after migration', dependsOn: ['step-3a'] },
            ],
          });
          return;
        }
        if (prompt.includes('Your task: Generic implementation')) {
          calls.push('generic-implementation');
          yield 'Generic implementation should have been replaced';
          return;
        }
        if (prompt.includes('Your task: Apply the schema migration')) {
          calls.push('migration-specialist');
          yield 'Migration complete';
          return;
        }
        if (prompt.includes('Your task: Implement after migration')) {
          calls.push('implementation-coder');
          yield 'Implementation complete';
          return;
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        maxStepRetries: 0,
        retryDelayMs: 0,
        adaptiveReplanning: {
          enabled: true,
          refreshAgents: async () => refreshedAgents,
        },
      },
    );

    if (!result.success) console.error(JSON.stringify(result.steps, null, 2));
    expect(result.success).toBe(true);
    expect(calls).toEqual([
      'spec-qa-reviewer',
      'adviser',
      'migration-specialist',
      'implementation-coder',
    ]);
    expect(result.steps.map((step) => step.id)).toEqual(['step-1', 'step-2', 'step-3a', 'step-4']);
    expect(result.steps.find((step) => step.id === 'step-3')).toBeUndefined();
    expect(result.steps.find((step) => step.id === 'step-3a')?.agent).toBe('migration-specialist');
    expect(result.replans).toEqual([
      {
        type: 'adviser-replan',
        fromStep: 'step-2',
        removedSteps: ['step-3'],
        insertedSteps: ['step-3a', 'step-4'],
        refreshedAgents: true,
      },
    ]);
  });


  it('continues the original DAG when adviser workflow references an unknown agent', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'spec-qa-reviewer', task: 'Approve spec', dependsOn: [] },
        { id: 'step-2', agent: 'adviser', task: 'Advise workflow', dependsOn: ['step-1'] },
        { id: 'step-3', agent: 'implementation-coder', task: 'Implement original plan', dependsOn: ['step-2'] },
      ],
    };
    const agents = new Map([
      ['spec-qa-reviewer', makeAgent('spec-qa-reviewer')],
      ['adviser', makeAgent('adviser')],
      ['implementation-coder', makeAgent('implementation-coder', 'files')],
    ]);
    const decisions: Array<{ decision: string; agent: string; reason: string }> = [];
    const reporter = {
      dagStepStart: vi.fn(),
      dagStepOutput: vi.fn(),
      dagStepComplete: vi.fn(),
      dagStepRetry: vi.fn(),
      dagStepFailed: vi.fn(),
      dagStepSkipped: vi.fn(),
      agentDecision(event: { decision: string; agent: string; reason: string }) {
        decisions.push(event);
      },
      onChunk: vi.fn(),
    };
    const calls: string[] = [];
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (prompt.includes('Approve spec')) {
          calls.push('spec');
          yield 'Spec approved';
          return;
        }
        if (prompt.includes('Advise workflow')) {
          calls.push('adviser');
          yield JSON.stringify({
            kind: 'adviser-workflow',
            plan: [
              { id: 'step-3a', agent: 'implementation-engineer', task: 'Implement using invented agent', dependsOn: ['step-2'] },
            ],
          });
          return;
        }
        if (prompt.includes('Implement original plan')) {
          calls.push('implementation-coder');
          yield 'Original implementation completed';
          return;
        }
        throw new Error(`Unexpected prompt: ${prompt}`);
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      reporter as never,
      undefined,
      undefined,
      undefined,
      {
        maxStepRetries: 0,
        retryDelayMs: 0,
        adaptiveReplanning: { enabled: true },
      },
    );

    expect(result.success).toBe(true);
    expect(calls).toEqual(['spec', 'adviser', 'implementation-coder']);
    expect(result.steps.map((step) => step.id)).toEqual(['step-1', 'step-2', 'step-3']);
    expect(result.steps.find((step) => step.id === 'step-3')?.output).toBe('Original implementation completed');
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        decision: 'not-needed',
        agent: 'additional-agent',
      }),
    ]));
  });


  it('warns when implementation file-output steps report success without workspace changes', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-file-output-no-change-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] }],
    };
    const agents = new Map([['implementation-coder', makeAgent('implementation-coder', 'files')]]);
    const createAdapter = vi.fn(() => mockAdapter('Implementation complete.'));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      workingDir,
      maxStepRetries: 0,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.steps[0]?.handoffFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'medium',
        message: expect.stringContaining('workspace file changes'),
      }),
    ]));
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  it('records workspace changes for implementation file-output steps', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-file-output-change-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] }],
    };
    const agents = new Map([['implementation-coder', makeAgent('implementation-coder', 'files')]]);
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'claude',
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, options?: { cwd?: string }) {
        await fs.writeFile(path.join(options?.cwd ?? workingDir, 'created.txt'), 'created\n', 'utf8');
        yield 'Created created.txt and ran verification.';
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      workingDir,
      maxStepRetries: 0,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.steps[0]?.filesCreated).toContain('created.txt');
    await fs.rm(workingDir, { recursive: true, force: true });
  });


  it('does not fail the DAG when adviser revision returns malformed workflow JSON', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'adviser', task: 'Advise workflow', dependsOn: [] },
        { id: 'step-2', agent: 'implementation-coder', task: 'Implement original plan', dependsOn: ['step-1'] },
      ],
    };
    const adviser = makeAgent('adviser', 'answer');
    const codeQaAnalyst = makeAgent('code-qa-analyst', 'answer');
    const releaseReadinessReviewer = makeAgent('release-readiness-reviewer', 'answer');
    const implementationCoder = makeAgent('implementation-coder', 'files');
    const agents = new Map([
      ['adviser', adviser],
      ['code-qa-analyst', codeQaAnalyst],
      ['release-readiness-reviewer', releaseReadinessReviewer],
      ['implementation-coder', implementationCoder],
    ]);
    const outputs: string[] = [
      'Initial adviser prose with workflow idea',
      'Review says revise',
      '{"decision":"revise","rationale":"replace placeholder","remediation":["fix malformed workflow"],"residualRisks":[]}',
      'Implementation continued',
    ];
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'claude',
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        if (prompt.includes('Implement original plan')) {
          yield 'Implementation continued';
          return;
        }
        yield outputs.shift() ?? '';
      },
    }));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        crossReview: {
          ...DEFAULT_CROSS_REVIEW_CONFIG,
          maxRounds: 1,
        },
        maxStepRetries: 0,
        retryDelayMs: 0,
        localModelConcurrency: 1,
      },
    );

    expect(result.success).toBe(true);
    expect(result.steps.find((step) => step.id === 'step-1')?.crossReview).toMatchObject({
      status: 'budget-exhausted',
      budgetExhausted: true,
    });
    expect(result.steps.find((step) => step.id === 'step-2')?.output).toBe('Implementation continued');
  });


  it('retries an empty file-output step with explicit file-output remediation context', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-empty-file-output-retry-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'tdd-engineer', task: 'Write failing tests', dependsOn: [] }],
    };
    const tdd = makeAgent('tdd-engineer', 'files');
    const agents = new Map([['tdd-engineer', tdd]]);
    const prompts: string[] = [];
    let runCount = 0;
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'ollama',
      model: 'test-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        prompts.push(prompt);
        runCount += 1;
        yield runCount === 1 ? '' : 'Created tests/pubchem-sync.test.ts and ran npm test (expected red).';
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      workingDir,
      maxStepRetries: 0,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.steps[0]).toMatchObject({
      status: 'completed',
      attempts: 2,
      output: expect.stringContaining('Created tests/pubchem-sync.test.ts'),
    });
    expect(prompts[1]).toContain('Your previous file-output response was empty');
    expect(prompts[1]).toContain('create or modify files in the workspace');
    await fs.rm(workingDir, { recursive: true, force: true });
  });




  it('normalizes no-diff decomposition workflows to implementation lanes when TDD artifacts already exist', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-decompose-normalize-'));
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'software-delivery', task: 'Implement broad feature', dependsOn: [] },
        { id: 'step-2', agent: 'code-qa-analyst', task: 'Review implementation', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['software-delivery', makeAgent('software-delivery', 'files')],
      ['adviser', makeAgent('adviser', 'answer')],
      ['implementation-coder', makeAgent('implementation-coder', 'files')],
      ['tdd-engineer', makeAgent('tdd-engineer', 'files')],
      ['code-qa-analyst', makeAgent('code-qa-analyst', 'answer')],
    ]);
    const adviserWorkflow = JSON.stringify({
      kind: 'adviser-workflow',
      refreshAgents: false,
      plan: [
        { id: 'new-tdd', agent: 'tdd-engineer', task: 'Write more tests', dependsOn: ['step-1-decompose-1'] },
        { id: 'new-impl', agent: 'implementation-coder', task: 'Implement from existing tests', dependsOn: ['new-tdd'] },
      ],
    });
    const createAdapter = createQueueAdapter([
      'Implementation complete but no files changed.',
      adviserWorkflow,
      'implementation done',
      'qa done',
    ]);

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      workingDir,
      maxStepRetries: 0,
      retryDelayMs: 0,
      adaptiveReplanning: { enabled: true },
    });

    expect(result.success).toBe(true);
    expect(result.plan.plan.map((step) => step.id)).toContain('new-impl');
    expect(result.plan.plan.map((step) => step.id)).not.toContain('new-tdd');
    expect(result.plan.plan.find((step) => step.id === 'new-impl')?.dependsOn).toEqual(['step-1-decompose-1']);
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  it('decomposes broad file-output work that returns no usable output or file evidence', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-empty-file-output-decompose-'));
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'software-delivery', task: 'Implement broad feature', dependsOn: [] },
        { id: 'step-2', agent: 'code-qa-analyst', task: 'Review implementation', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['software-delivery', makeAgent('software-delivery', 'files')],
      ['adviser', makeAgent('adviser', 'answer')],
      ['code-qa-analyst', makeAgent('code-qa-analyst', 'answer')],
    ]);
    const createAdapter = createQueueAdapter([
      '',
      '',
      'Return a valid implementation-coder slice plan.',
      'QA sees decomposition guidance.',
    ]);

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      workingDir,
      maxStepRetries: 0,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.plan.plan.map((step) => step.id)).toEqual([
      'step-1',
      'step-1-decompose-1',
      'step-2',
    ]);
    expect(result.steps.find((step) => step.id === 'step-1')).toMatchObject({
      status: 'completed',
      error: expect.stringContaining('file-output step completed without usable output'),
    });
    expect(result.plan.plan.find((step) => step.id === 'step-2')?.dependsOn).toEqual(['step-1-decompose-1']);
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  it('inserts an adviser decomposition lane before downstream work when implementation produces no diff', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-no-diff-decompose-'));
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'software-delivery', task: 'Implement broad feature', dependsOn: [] },
        { id: 'step-2', agent: 'code-qa-analyst', task: 'Review implementation', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['software-delivery', makeAgent('software-delivery', 'files')],
      ['adviser', makeAgent('adviser', 'answer')],
      ['code-qa-analyst', makeAgent('code-qa-analyst', 'answer')],
    ]);
    const createAdapter = createQueueAdapter([
      'Implementation complete but no files changed.',
      'Decompose into file-scoped slices using implementation-coder and tdd-engineer.',
      'QA sees decomposition guidance.',
    ]);

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      workingDir,
      maxStepRetries: 0,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.plan.plan.map((step) => step.id)).toEqual([
      'step-1',
      'step-1-decompose-1',
      'step-2',
    ]);
    expect(result.plan.plan.find((step) => step.id === 'step-2')?.dependsOn).toEqual(['step-1-decompose-1']);
    expect(result.steps.find((step) => step.id === 'step-1-decompose-1')).toMatchObject({
      agent: 'adviser',
      parentStepId: 'step-1',
      edgeType: 'feedback',
    });
    expect(result.plan.plan.find((step) => step.id === 'step-1-decompose-1')?.task).toContain('Return ONLY adviser-workflow JSON');
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  it('allows implementation file-output agents enough tool rounds to inspect, edit, and verify', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] }],
    };
    const implementation = makeAgent('implementation-coder', 'files');
    implementation.tools = [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['node'] } }];
    const agents = new Map([['implementation-coder', implementation]]);
    let runCount = 0;
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'ollama',
      model: 'test-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        runCount += 1;
        if (runCount <= 7) {
          yield JSON.stringify({ tool: 'shell', params: { command: `node -e "console.log('round-${runCount}')"` } });
          return;
        }
        yield 'Created tests/pubchem-sync.test.ts and ran targeted test command.';
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      maxStepRetries: 0,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.steps[0]?.output).toContain('Created tests/pubchem-sync.test.ts');
    expect(runCount).toBe(8);
  });


  it('caps tdd-engineer tool loops lower so partial tests hand off quickly', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-tdd-tool-cap-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'tdd-engineer', task: 'Write tests', dependsOn: [] }],
    };
    const tdd = makeAgent('tdd-engineer', 'files');
    tdd.tools = [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['node'] } }];
    const agents = new Map([['tdd-engineer', tdd]]);
    let runCount = 0;
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'ollama',
      model: 'test-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        runCount += 1;
        if (runCount === 1) {
          yield JSON.stringify({ tool: 'shell', params: { command: 'node -e "require(\'fs\').writeFileSync(\'quick.test.js\', \'test\')"' } });
          return;
        }
        yield JSON.stringify({ tool: 'shell', params: { command: `node -e "console.log(${runCount})"` } });
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      maxStepRetries: 0,
      retryDelayMs: 0,
      workingDir,
    });

    expect(result.success).toBe(true);
    expect(result.steps[0]?.output).toContain('Tool-loop condition: Tool loop exceeded 4 rounds');
    expect(result.steps[0]?.filesCreated).toEqual(['quick.test.js']);
    expect(runCount).toBeLessThanOrEqual(6);
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  it('keeps non-TDD file-output agents in the same tool loop when they repeat an identical successful inspection call', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] }],
    };
    const implementation = makeAgent('implementation-coder', 'files');
    implementation.tools = [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['printf'] } }];
    const agents = new Map([['implementation-coder', implementation]]);
    const prompts: string[] = [];
    let runCount = 0;
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'ollama',
      model: 'test-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        prompts.push(prompt);
        runCount += 1;
        if (runCount <= 2) {
          yield JSON.stringify({ tool: 'shell', params: { command: 'printf inspect' } });
          return;
        }
        yield 'Created tests/pubchem-sync.test.ts and ran targeted test command.';
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      maxStepRetries: 0,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.steps[0]?.output).toContain('Created tests/pubchem-sync.test.ts');
    expect(runCount).toBe(3);
    expect(prompts[2]).toContain('Repeated tool call blocked');
    expect(prompts[2]).toContain('Do not repeat it.');
  });

  it('executes declared tools before returning the final step output', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research current status', dependsOn: [] }],
    };
    const researcher = makeAgent('researcher');
    researcher.tools = [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['printf'] } }];
    const agents = new Map([['researcher', researcher]]);
    let runCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        runCount += 1;
        if (runCount === 1) {
          yield '{"tool":"shell","params":{"command":"printf current-status"}}';
          return;
        }
        yield 'Final synthesized answer';
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter);
    expect(result.success).toBe(true);
    expect(result.steps[0].output).toBe('Final synthesized answer');
    expect(runCount).toBe(2);
  });

  it('routes file-output disagreement through revision re-review until accepted without user blocking', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] },
        { id: 'step-2', agent: 'release-readiness-reviewer', task: 'Assess readiness', dependsOn: ['step-1'] },
      ],
    };
    const implementationCoder = makeAgent('implementation-coder', 'files');
    const codeQaAnalyst = makeAgent('code-qa-analyst', 'answer');
    const releaseReadinessReviewer = makeAgent('release-readiness-reviewer', 'answer');
    implementationCoder.adapter = 'ollama';
    implementationCoder.model = 'implementation-model';
    codeQaAnalyst.adapter = 'ollama';
    codeQaAnalyst.model = 'reviewer-model';
    releaseReadinessReviewer.adapter = 'ollama';
    releaseReadinessReviewer.model = 'judge-model';
    const agents = new Map([
      ['implementation-coder', implementationCoder],
      ['code-qa-analyst', codeQaAnalyst],
      ['release-readiness-reviewer', releaseReadinessReviewer],
    ]);
    const prompts: string[] = [];
    const createAdapter = createCapturingQueueAdapter([
      'source output',
      'review output: needs revision',
      '{"decision":"revise","rationale":"file output needs a regression test","remediation":["add regression test"],"residualRisks":["coverage gap"]}',
      'revision output',
      'revision review output: regression added',
      '{"decision":"accept","rationale":"revision accepted","remediation":[],"residualRisks":[]}',
      'readiness output',
    ], prompts);

    const crossReviewConfig = {
      ...DEFAULT_CROSS_REVIEW_CONFIG,
      maxRounds: 2,
      gates: { ...DEFAULT_CROSS_REVIEW_CONFIG.gates, releaseReadiness: false },
    };
    const verboseWrites: string[] = [];
    const reporter = new VerboseReporter({
      supportsColor: false,
      write(text) { verboseWrites.push(text); },
      clearLine() {},
    });
    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      reporter,
      undefined,
      undefined,
      undefined,
      {
        crossReview: crossReviewConfig,
        localModelConcurrency: 1,
        maxStepRetries: 0,
        retryDelayMs: 0,
      },
    );

    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.id)).toEqual(expect.arrayContaining([
      'step-1',
      'step-1-peer-review-1',
      'step-1-judge-1',
      'step-1-revision-1',
      'step-1-peer-review-2',
      'step-1-judge-2',
      'step-2',
    ]));
    expect(result.steps.find((step) => step.id === 'step-1-peer-review-1')).toMatchObject({
      edgeType: 'review',
      parentStepId: 'step-1',
    });
    expect(result.steps.find((step) => step.id === 'step-1-judge-1')).toMatchObject({
      edgeType: 'judge',
      parentStepId: 'step-1',
    });
    expect(result.steps.find((step) => step.id === 'step-1-revision-1')).toMatchObject({
      edgeType: 'feedback',
      parentStepId: 'step-1',
    });
    expect(result.steps.find((step) => step.id === 'step-1-peer-review-2')).toMatchObject({
      edgeType: 'review',
      parentStepId: 'step-1',
    });
    expect(result.steps.find((step) => step.id === 'step-1-judge-2')).toMatchObject({
      edgeType: 'judge',
      parentStepId: 'step-1',
    });
    expect(result.steps.find((step) => step.id === 'step-1')?.crossReview).toMatchObject({
      status: 'accepted',
      judgeDecision: 'accept',
      revisionStepId: 'step-1-revision-1',
      reviewStepId: 'step-1-peer-review-2',
      judgeStepId: 'step-1-judge-2',
      residualRisks: [],
      budgetExhausted: false,
    });
    expect(result.plan.plan.find((step) => step.id === 'step-2')?.dependsOn).toEqual([
      'step-1-revision-1',
      'step-1-judge-2',
    ]);
    const downstreamPrompt = prompts.find((prompt) => prompt.includes('Your task: Assess readiness'));
    expect(downstreamPrompt).toContain('[step-1-revision-1: implementation-coder]\nrevision output');
    expect(downstreamPrompt).toContain('[step-1-judge-2: release-readiness-reviewer]');
    expect(downstreamPrompt).toContain('"decision":"accept"');
    expect(downstreamPrompt).toContain('"rationale":"revision accepted"');
    expect(downstreamPrompt).not.toContain('[step-1: implementation-coder]\nsource output');
    const verboseOutput = verboseWrites.join('');
    expect(verboseOutput).toContain('Cross-review — step-1 gate=fileOutputs round=1 decision=revise');
    expect(verboseOutput).toContain('file output needs a regression test');
    expect(verboseOutput).toContain('Cross-review — step-1 gate=fileOutputs round=2 decision=accept');
    expect(verboseOutput).toContain('revision accepted');
    expect(createAdapter).toHaveBeenCalledTimes(7);
  });

  it('routes structured code QA revise verdicts back to the developer and re-runs QA', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] },
        { id: 'step-2', agent: 'code-qa-analyst', task: 'Review implementation', dependsOn: ['step-1'] },
        { id: 'step-3', agent: 'release-readiness-reviewer', task: 'Assess readiness', dependsOn: ['step-2'] },
      ],
    };
    const agents = new Map([
      ['implementation-coder', makeAgent('implementation-coder', 'files')],
      ['code-qa-analyst', makeAgent('code-qa-analyst', 'answer')],
      ['release-readiness-reviewer', makeAgent('release-readiness-reviewer', 'answer')],
    ]);
    const prompts: string[] = [];
    const createAdapter = createCapturingQueueAdapter([
      'initial implementation',
      JSON.stringify({
        verdict: 'revise',
        blockingFindings: [
          {
            severity: 'high',
            file: 'src/sync.ts',
            issue: 'Resume path drops partial downloads',
            requiredFix: 'Persist byte offsets and verify checksum after resume',
          },
        ],
        verificationRequired: ['npm test -- pubchem-sync'],
      }),
      'fixed implementation',
      JSON.stringify({ verdict: 'accept', blockingFindings: [], verificationRequired: [] }),
      'ready',
    ], prompts);

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        crossReview: { ...DEFAULT_CROSS_REVIEW_CONFIG, enabled: false },
        localModelConcurrency: 1,
        maxStepRetries: 0,
        retryDelayMs: 0,
      },
    );

    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.id)).toEqual(expect.arrayContaining([
      'step-1',
      'step-2',
      'step-2-fix-1',
      'step-2-retry-1',
      'step-3',
    ]));
    expect(result.steps.find((step) => step.id === 'step-2')).toMatchObject({
      status: 'recovered',
      replacementStepId: 'step-2-retry-1',
    });
    expect(result.steps.find((step) => step.id === 'step-2-fix-1')).toMatchObject({
      agent: 'implementation-coder',
      parentStepId: 'step-2',
      edgeType: 'feedback',
    });
    expect(result.steps.find((step) => step.id === 'step-2-retry-1')).toMatchObject({
      agent: 'code-qa-analyst',
      parentStepId: 'step-2',
      edgeType: 'feedback',
    });
    expect(result.plan.plan.find((step) => step.id === 'step-3')?.dependsOn).toEqual(['step-2-retry-1']);
    const fixPrompt = prompts.find((prompt) => prompt.includes('Your task: Fix implementation issues found by code QA'));
    expect(fixPrompt).toContain('Resume path drops partial downloads');
    expect(fixPrompt).toContain('Persist byte offsets and verify checksum after resume');
    expect(fixPrompt).toContain('npm test -- pubchem-sync');
    const readinessPrompt = prompts.find((prompt) => prompt.includes('Your task: Assess readiness'));
    expect(readinessPrompt).toContain('[step-2-retry-1: code-qa-analyst]');
    expect(readinessPrompt).toContain('"verdict":"accept"');
  });

  it('passes both accepted source output and terminal judge decision to downstream steps', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] },
        { id: 'step-2', agent: 'release-readiness-reviewer', task: 'Assess readiness', dependsOn: ['step-1'] },
      ],
    };
    const implementationCoder = makeAgent('implementation-coder', 'files');
    const codeQaAnalyst = makeAgent('code-qa-analyst', 'answer');
    const releaseReadinessReviewer = makeAgent('release-readiness-reviewer', 'answer');
    const agents = new Map([
      ['implementation-coder', implementationCoder],
      ['code-qa-analyst', codeQaAnalyst],
      ['release-readiness-reviewer', releaseReadinessReviewer],
    ]);
    const prompts: string[] = [];
    const createAdapter = createCapturingQueueAdapter([
      'source output',
      'review output: source accepted',
      '{"decision":"accept","rationale":"source accepted","remediation":[],"residualRisks":[]}',
      'readiness output',
    ], prompts);

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        crossReview: {
          ...DEFAULT_CROSS_REVIEW_CONFIG,
          gates: { ...DEFAULT_CROSS_REVIEW_CONFIG.gates, releaseReadiness: false },
        },
        localModelConcurrency: 1,
        maxStepRetries: 0,
        retryDelayMs: 0,
      },
    );

    expect(result.success).toBe(true);
    expect(result.plan.plan.find((step) => step.id === 'step-2')?.dependsOn).toEqual([
      'step-1',
      'step-1-judge-1',
    ]);
    const downstreamPrompt = prompts.find((prompt) => prompt.includes('Your task: Assess readiness'));
    expect(downstreamPrompt).toContain('[step-1: implementation-coder]\nsource output');
    expect(downstreamPrompt).toContain('[step-1-judge-1: release-readiness-reviewer]');
    expect(downstreamPrompt).toContain('"decision":"accept"');
    expect(downstreamPrompt).toContain('"rationale":"source accepted"');
    expect(createAdapter).toHaveBeenCalledTimes(4);
  });

  it('marks the root cross-review ledger budget-exhausted when another revision would exceed max rounds', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] },
        { id: 'step-2', agent: 'release-readiness-reviewer', task: 'Assess readiness', dependsOn: ['step-1'] },
      ],
    };
    const implementationCoder = makeAgent('implementation-coder', 'files');
    const codeQaAnalyst = makeAgent('code-qa-analyst', 'answer');
    const releaseReadinessReviewer = makeAgent('release-readiness-reviewer', 'answer');
    const agents = new Map([
      ['implementation-coder', implementationCoder],
      ['code-qa-analyst', codeQaAnalyst],
      ['release-readiness-reviewer', releaseReadinessReviewer],
    ]);
    const createAdapter = createQueueAdapter([
      'source output',
      'review output: needs revision',
      '{"decision":"revise","rationale":"still incomplete","remediation":["add missing coverage"],"residualRisks":["coverage gap"]}',
      'readiness output',
    ]);

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        crossReview: {
          ...DEFAULT_CROSS_REVIEW_CONFIG,
          maxRounds: 1,
          gates: { ...DEFAULT_CROSS_REVIEW_CONFIG.gates, releaseReadiness: false },
        },
        localModelConcurrency: 1,
        maxStepRetries: 0,
        retryDelayMs: 0,
      },
    );

    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.id)).not.toContain('step-1-revision-1');
    expect(result.steps.find((step) => step.id === 'step-1')?.crossReview).toMatchObject({
      status: 'budget-exhausted',
      judgeDecision: 'revise',
      requestedRemediation: ['add missing coverage'],
      budgetExhausted: true,
    });
    expect(result.plan.plan.find((step) => step.id === 'step-2')?.dependsOn).toEqual([
      'step-1',
      'step-1-judge-1',
    ]);
    expect(createAdapter).toHaveBeenCalledTimes(4);
  });






  it('preserves file-output changes created before a later retry exhausts tool calls', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-tool-loop-cross-retry-files-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'tdd-engineer', task: 'Write tests', dependsOn: [] }],
    };
    const tdd = makeAgent('tdd-engineer', 'files');
    tdd.tools = [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['node'] } }];
    const agents = new Map([['tdd-engineer', tdd]]);
    let runCount = 0;
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'ollama',
      model: 'test-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        runCount += 1;
        if (runCount === 1) {
          yield JSON.stringify({ tool: 'shell', params: { command: 'node -e "require(\'fs\').writeFileSync(\'generated.test.js\', \'test\')"' } });
          return;
        }
        yield JSON.stringify({ tool: 'shell', params: { command: `node -e "console.log(${runCount})"` } });
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      maxStepRetries: 1,
      retryDelayMs: 0,
      workingDir,
    });

    expect(result.success).toBe(true);
    expect(result.steps[0]?.status).toBe('completed');
    expect(result.steps[0]?.filesCreated).toEqual(['generated.test.js']);
    expect(result.steps[0]?.output).toContain('tool-call limit');
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  it('continues file-output work when repeated duplicate tool calls still leave changed files', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-duplicate-tool-partial-files-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'tdd-engineer', task: 'Write tests', dependsOn: [] }],
    };
    const tdd = makeAgent('tdd-engineer', 'files');
    tdd.tools = [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['node'] } }];
    const agents = new Map([['tdd-engineer', tdd]]);
    const command = 'node -e "require(\'fs\').writeFileSync(\'generated.test.js\', \'test\')"';
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'ollama',
      model: 'test-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        yield JSON.stringify({ tool: 'shell', params: { command } });
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      maxStepRetries: 0,
      retryDelayMs: 0,
      workingDir,
    });

    expect(result.success).toBe(true);
    expect(result.steps[0]?.status).toBe('completed');
    expect(result.steps[0]?.output).toContain('repeated identical successful tool call');
    expect(result.steps[0]?.filesCreated).toEqual(['generated.test.js']);
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  it('continues file-output work when the tool loop cap is reached after workspace changes', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-tool-loop-partial-files-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'tdd-engineer', task: 'Write failing tests', dependsOn: [] }],
    };
    const tdd = makeAgent('tdd-engineer', 'files');
    tdd.tools = [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['node'] } }];
    const agents = new Map([['tdd-engineer', tdd]]);
    let runCount = 0;
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'ollama',
      model: 'test-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        runCount += 1;
        if (runCount === 1) {
          yield JSON.stringify({ tool: 'shell', params: { command: 'node -e "require(\'fs\').writeFileSync(\'generated.test.js\', \'test\')"' } });
          return;
        }
        yield JSON.stringify({ tool: 'shell', params: { command: `node -e "console.log(${runCount})"` } });
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      maxStepRetries: 0,
      retryDelayMs: 0,
      workingDir,
    });

    expect(result.success).toBe(true);
    expect(result.steps[0]?.status).toBe('completed');
    expect(result.steps[0]?.output).toContain('tool-call limit');
    expect(result.steps[0]?.filesCreated).toEqual(['generated.test.js']);
    await fs.rm(workingDir, { recursive: true, force: true });
  });



  it('executes malformed multiline shell tool JSON emitted by local models', async () => {
    const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-malformed-tool-json-'));
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Create a file', dependsOn: [] }],
    };
    const implementation = makeAgent('implementation-coder', 'files');
    implementation.tools = [{ type: 'builtin', name: 'shell' }];
    const agents = new Map([['implementation-coder', implementation]]);
    let calls = 0;
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'ollama',
      model: 'test-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        calls += 1;
        if (calls === 1) {
          yield `\`\`\`json\n{"tool":"shell","params":{"command":"cat <<'EOF' > hello.txt\nhello from malformed json\nEOF"}}\n\`\`\``;
          return;
        }
        yield 'Created hello.txt and verified it exists.';
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      maxStepRetries: 0,
      retryDelayMs: 0,
      workingDir,
    });

    expect(result.success).toBe(true);
    expect(await fs.readFile(path.join(workingDir, 'hello.txt'), 'utf8')).toContain('hello from malformed json');
    expect(result.steps[0]?.filesCreated).toContain('hello.txt');
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  it('retries once and then fails a file-output agent that repeats the same successful tool call without progress', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'build-fixer', task: 'Run git diff --check', dependsOn: [] }],
    };
    const buildFixer = makeAgent('build-fixer', 'files');
    buildFixer.tools = [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['printf'] } }];
    const agents = new Map([['build-fixer', buildFixer]]);
    let runCount = 0;
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'ollama',
      model: 'test-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        runCount += 1;
        yield '{"tool":"shell","params":{"command":"printf clean"}}';
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      maxStepRetries: 0,
      retryDelayMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.steps[0]?.status).toBe('failed');
    expect(result.steps[0]?.error).toContain('identical successful tool call');
    expect(runCount).toBeGreaterThanOrEqual(4);
  });

  it('injects a no-progress remediation context before retrying a repeated identical tool call', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] }],
    };
    const implementation = makeAgent('implementation-coder', 'files');
    implementation.tools = [{ type: 'builtin', name: 'shell', config: { allowedCommands: ['printf'] } }];
    const agents = new Map([['implementation-coder', implementation]]);
    const prompts: string[] = [];
    let runCount = 0;
    const createAdapter = vi.fn((): AgentAdapter => ({
      type: 'ollama',
      model: 'test-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        prompts.push(prompt);
        runCount += 1;
        yield JSON.stringify({ tool: 'shell', params: { command: 'printf clean' } });
      },
    }));

    await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
      maxStepRetries: 0,
      retryDelayMs: 0,
    });

    expect(runCount).toBeGreaterThanOrEqual(4);
    expect(prompts.some((prompt) => prompt.includes('No-Progress Tool Loop Remediation Required'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('Do not repeat the same tool call again'))).toBe(true);
  });

  it('does not security-gate cross-review control outputs before judge decisions are parsed', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] },
        { id: 'step-2', agent: 'release-readiness-reviewer', task: 'Assess readiness', dependsOn: ['step-1'] },
      ],
    };
    const implementationCoder = makeAgent('implementation-coder', 'files');
    const codeQaAnalyst = makeAgent('code-qa-analyst', 'answer');
    codeQaAnalyst.tools = [{ type: 'builtin', name: 'shell' }];
    const releaseReadinessReviewer = makeAgent('release-readiness-reviewer', 'answer');
    releaseReadinessReviewer.tools = [{ type: 'builtin', name: 'shell' }];
    const agents = new Map([
      ['implementation-coder', implementationCoder],
      ['code-qa-analyst', codeQaAnalyst],
      ['release-readiness-reviewer', releaseReadinessReviewer],
    ]);
    const createAdapter = createQueueAdapter([
      'source output',
      'review output',
      '{"decision":"accept","rationale":"accepted","remediation":[],"residualRisks":[]}',
      'readiness output',
    ]);
    const securityPrompts: string[] = [];
    const createReviewAdapter = () => ({
      type: 'ollama' as const,
      model: 'security-model',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        securityPrompts.push(prompt);
        if (prompt.includes('Task: Judge the original step output')) {
          yield 'SECURITY_PASSED: false';
          return;
        }
        yield 'SECURITY_PASSED: true';
      },
    });

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      {
        config: { ...securityConfig, llmReviewEnabled: true },
        createReviewAdapter,
      },
      undefined,
      undefined,
      {
        crossReview: {
          ...DEFAULT_CROSS_REVIEW_CONFIG,
          gates: { ...DEFAULT_CROSS_REVIEW_CONFIG.gates, releaseReadiness: false },
        },
        localModelConcurrency: 1,
        maxStepRetries: 0,
        retryDelayMs: 0,
      },
    );

    expect(result.success).toBe(true);
    const judgeResult = result.steps.find((step) => step.id === 'step-1-judge-1');
    expect(judgeResult).toMatchObject({ status: 'completed' });
    expect(judgeResult).not.toHaveProperty('securityPassed');
    expect(result.steps.find((step) => step.id === 'step-1')?.securityPassed).toBe(true);
    expect(securityPrompts.some((prompt) => prompt.includes('Task: Judge the original step output'))).toBe(false);
  });


  it('does not evidence-gate cross-review judge control outputs before decisions are parsed', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] }],
    };
    const implementationCoder = makeAgent('implementation-coder', 'files');
    const codeQaAnalyst = makeAgent('code-qa-analyst', 'answer');
    const releaseReadinessReviewer = makeAgent('release-readiness-reviewer', 'answer');
    const agents = new Map([
      ['implementation-coder', implementationCoder],
      ['code-qa-analyst', codeQaAnalyst],
      ['release-readiness-reviewer', releaseReadinessReviewer],
    ]);
    const createAdapter = createQueueAdapter([
      'source output',
      'review output',
      '{"decision":"accept","rationale":"accepted","remediation":[],"residualRisks":[]}',
    ]);

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        crossReview: DEFAULT_CROSS_REVIEW_CONFIG,
        evidence: {
          ...DEFAULT_EVIDENCE_CONFIG,
          requiredAgents: ['release-readiness-reviewer'],
          remediationMaxRetries: 0,
        },
        localModelConcurrency: 1,
        maxStepRetries: 0,
        retryDelayMs: 0,
      },
    );

    expect(result.success).toBe(true);
    const judgeResult = result.steps.find((step) => step.id === 'step-1-judge-1');
    expect(judgeResult).toMatchObject({
      status: 'completed',
      evidenceGate: { checked: false, passed: true },
    });
    expect(result.steps.find((step) => step.id === 'step-1')?.crossReview).toMatchObject({
      status: 'accepted',
      judgeDecision: 'accept',
    });
  });

  it('uses configured cross-review judge models for review and judge helper execution', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] }],
    };
    const implementationCoder = makeAgent('implementation-coder', 'files');
    implementationCoder.adapter = 'claude';
    implementationCoder.model = 'source-model';
    const codeQaAnalyst = makeAgent('code-qa-analyst', 'answer');
    codeQaAnalyst.adapter = 'codex';
    codeQaAnalyst.model = 'reviewer-default';
    const releaseReadinessReviewer = makeAgent('release-readiness-reviewer', 'answer');
    releaseReadinessReviewer.adapter = 'claude';
    releaseReadinessReviewer.model = 'judge-default';
    const agents = new Map([
      ['implementation-coder', implementationCoder],
      ['code-qa-analyst', codeQaAnalyst],
      ['release-readiness-reviewer', releaseReadinessReviewer],
    ]);
    const outputs = [
      'source output',
      'review output',
      '{"decision":"accept","rationale":"accepted","remediation":[],"residualRisks":[]}',
    ];
    const adapterConfigs: Array<Pick<AdapterConfig, 'type' | 'model'>> = [];
    const createAdapter = vi.fn((config: AdapterConfig): AgentAdapter => {
      adapterConfigs.push({ type: config.type, model: config.model });
      return {
        type: config.type,
        model: config.model,
        detect: vi.fn(),
        cancel: vi.fn(),
        async *run() {
          yield outputs.shift() ?? '';
        },
      };
    });

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        crossReview: {
          ...DEFAULT_CROSS_REVIEW_CONFIG,
          judge: {
            ...DEFAULT_CROSS_REVIEW_CONFIG.judge,
            models: ['ollama/model-a', 'ollama/model-b'],
          },
        },
        localModelConcurrency: 1,
        maxStepRetries: 0,
        retryDelayMs: 0,
      },
    );

    expect(result.success).toBe(true);
    expect(adapterConfigs).toEqual([
      { type: 'claude', model: 'source-model' },
      { type: 'ollama', model: 'model-a' },
      { type: 'ollama', model: 'model-b' },
    ]);
    expect(result.steps.find((step) => step.id === 'step-1-peer-review-1')).toMatchObject({
      provider: 'ollama',
      model: 'model-a',
    });
    expect(result.steps.find((step) => step.id === 'step-1-judge-1')).toMatchObject({
      provider: 'ollama',
      model: 'model-b',
    });
  });

  it('keeps reviewer and judge separate when a distinct cross-review judge is available', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'release-readiness-reviewer', task: 'Assess readiness', dependsOn: [] }],
    };
    const releaseReadinessReviewer = makeAgent('release-readiness-reviewer', 'answer');
    const codeQaAnalyst = makeAgent('code-qa-analyst', 'answer');
    const adviser = makeAgent('adviser', 'answer');
    const specQaReviewer = makeAgent('spec-qa-reviewer', 'answer');
    const agents = new Map([
      ['release-readiness-reviewer', releaseReadinessReviewer],
      ['code-qa-analyst', codeQaAnalyst],
      ['adviser', adviser],
      ['spec-qa-reviewer', specQaReviewer],
    ]);
    const createAdapter = createQueueAdapter([
      'readiness output',
      'review output',
      '{"decision":"accept","rationale":"accepted","remediation":[],"residualRisks":[]}',
    ]);

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        crossReview: {
          ...DEFAULT_CROSS_REVIEW_CONFIG,
          judge: { ...DEFAULT_CROSS_REVIEW_CONFIG.judge, preferSeparatePanel: true },
        },
        localModelConcurrency: 1,
        maxStepRetries: 0,
        retryDelayMs: 0,
      },
    );

    expect(result.success).toBe(true);
    expect(result.steps.find((step) => step.id === 'step-1-peer-review-1')?.agent).toBe('code-qa-analyst');
    expect(result.steps.find((step) => step.id === 'step-1-judge-1')?.agent).toBe('adviser');
    const participants = result.steps.find((step) => step.id === 'step-1')?.crossReview?.participants ?? [];
    expect(participants.find((participant) => participant.role === 'reviewer')?.agent).toBe('code-qa-analyst');
    expect(participants.find((participant) => participant.role === 'judge')?.agent).toBe('adviser');
  });
});
