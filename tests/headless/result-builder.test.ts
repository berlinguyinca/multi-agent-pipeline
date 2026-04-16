import { describe, it, expect } from 'vitest';
import { buildHeadlessResultV2 } from '../../src/headless/result-builder.js';
import type { DAGPlan, StepResult } from '../../src/types/dag.js';

describe('buildHeadlessResultV2', () => {
  it('builds success result from completed DAG', () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build', dependsOn: ['step-1'] },
      ],
    };
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', outputType: 'answer', output: 'Found info', duration: 5000 },
      { id: 'step-2', agent: 'coder', task: 'Build', status: 'completed', outputType: 'files', output: 'Built it', filesCreated: ['src/app.ts'], duration: 10000 },
    ];

    const result = buildHeadlessResultV2(plan, steps, 15000, undefined, {
      outputDir: '/tmp/out',
      markdownFiles: ['/tmp/out/map-output/pipe/final-report.md'],
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

    expect(result.version).toBe(2);
    expect(result.success).toBe(true);
    expect(result.dag.nodes).toHaveLength(2);
    expect(result.dag.edges).toHaveLength(1);
    expect(result.dag.edges[0]).toEqual({ from: 'step-1', to: 'step-2', type: 'planned' });
    expect(result.steps).toEqual(steps);
    expect(result.duration).toBe(15000);
    expect(result.error).toBeNull();
    expect(result.outputDir).toBe('/tmp/out');
    expect(result.markdownFiles).toEqual(['/tmp/out/map-output/pipe/final-report.md']);
    expect(result.consensusDiagnostics?.[0].participants.map((participant) => participant.model)).toEqual(['gemma4', 'qwen3']);
  });

  it('builds failure result with error', () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research', dependsOn: [] }],
    };
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'failed', error: 'timeout', duration: 30000 },
    ];

    const result = buildHeadlessResultV2(plan, steps, 30000);

    expect(result.version).toBe(2);
    expect(result.success).toBe(false);
    expect(result.error).toBeNull();
    expect(result.steps[0].error).toBe('timeout');
  });

  it('includes top-level error when provided', () => {
    const plan: DAGPlan = { plan: [] };
    const result = buildHeadlessResultV2(plan, [], 0, 'Router failed');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Router failed');
  });



  it('marks explicit final DAG nodes in the result graph', () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'writer', task: 'Write final', dependsOn: [], final: true },
      ],
    };
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'writer', task: 'Write final', status: 'completed', output: 'Final' },
    ];

    const result = buildHeadlessResultV2(plan, steps, 1000);

    expect(result.dag.nodes[0]).toMatchObject({ id: 'step-1', final: true });
  });

  it('builds the graph from the mutated runtime DAG including inserted polishing steps', () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research', dependsOn: [] },
        { id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', task: 'Polish research', dependsOn: ['step-1'] },
        { id: 'step-2', agent: 'writer', task: 'Write with polished research', dependsOn: ['step-1-grammar-1'] },
      ],
    };
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', outputType: 'answer', output: 'Raw research' },
      { id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', task: 'Polish research', status: 'completed', outputType: 'answer', output: 'Polished research' },
      { id: 'step-2', agent: 'writer', task: 'Write with polished research', status: 'completed', outputType: 'answer', output: 'Final report' },
    ];

    const result = buildHeadlessResultV2(plan, steps, 1000);

    expect(result.dag.nodes.map((node) => node.id)).toEqual([
      'step-1',
      'step-1-grammar-1',
      'step-2',
    ]);
    expect(result.dag.edges).toEqual([
      { from: 'step-1', to: 'step-1-grammar-1', type: 'planned' },
      { from: 'step-1-grammar-1', to: 'step-2', type: 'planned' },
    ]);
  });

  it('treats recovered steps as successful terminal output', () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] },
        { id: 'step-1-recovery-1', agent: 'build-fixer', task: 'Fix compile failure', dependsOn: ['step-1'] },
        { id: 'step-1-retry-1', agent: 'implementation-coder', task: 'Retry feature', dependsOn: ['step-1-recovery-1'] },
      ],
    };
    const steps: StepResult[] = [
      {
        id: 'step-1',
        agent: 'implementation-coder',
        task: 'Implement feature',
        status: 'recovered',
        error: 'TypeScript compile failed',
        replacementStepId: 'step-1-retry-1',
      },
      {
        id: 'step-1-recovery-1',
        agent: 'build-fixer',
        task: 'Fix compile failure',
        status: 'completed',
        outputType: 'files',
        output: 'Fixed imports',
      },
      {
        id: 'step-1-retry-1',
        agent: 'implementation-coder',
        task: 'Retry feature',
        status: 'completed',
        outputType: 'files',
        output: 'Implemented feature',
      },
    ];

    const result = buildHeadlessResultV2(plan, steps, 1200);
    expect(result.success).toBe(true);
  });
});
