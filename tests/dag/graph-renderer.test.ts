import { describe, expect, it } from 'vitest';
import { renderSimplifiedGraph } from '../../src/dag/graph-renderer.js';
import type { DAGResult } from '../../src/types/dag.js';

describe('renderSimplifiedGraph', () => {
  it('labels planned, handoff, recovery, and spawned edges clearly', () => {
    const dag: DAGResult = {
      nodes: [
        { id: 'step-1', agent: 'researcher', status: 'completed', duration: 1 },
        { id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', status: 'completed', duration: 1 },
        { id: 'step-2', agent: 'implementation-coder', status: 'failed', duration: 1 },
        { id: 'step-2-recovery-1', agent: 'build-fixer', status: 'completed', duration: 1 },
        { id: 'step-2-retry-1', agent: 'implementation-coder', status: 'completed', duration: 1 },
      ],
      edges: [
        { from: 'step-1', to: 'step-1-grammar-1', type: 'handoff' },
        { from: 'step-1-grammar-1', to: 'step-2', type: 'planned' },
        { from: 'step-2', to: 'step-2-recovery-1', type: 'recovery' },
        { from: 'step-2-recovery-1', to: 'step-2-retry-1', type: 'planned' },
      ],
    };

    const rendered = renderSimplifiedGraph(dag).join('\n');

    expect(rendered).toContain('Stage 1 (sequence):');
    expect(rendered).toContain('step-1 [researcher] completed');
    expect(rendered).toContain('step-1 --handoff--> step-1-grammar-1');
    expect(rendered).toContain('step-1-grammar-1 -> step-2 (planned)');
    expect(rendered).toContain('step-2 --recovery--> step-2-recovery-1');
    expect(rendered).toContain('step-2-recovery-1 -> step-2-retry-1 (planned)');
  });

  it('renders compact dependency stages with concurrency and consensus run models', () => {
    const dag: DAGResult = {
      nodes: [
        {
          id: 'step-1',
          agent: 'researcher',
          status: 'completed',
          duration: 10,
          consensus: {
            enabled: true,
            runs: 3,
            candidateCount: 3,
            selectedRun: 1,
            agreement: 2 / 3,
            method: 'exact-majority',
            participants: [
              { run: 1, provider: 'ollama', model: 'gemma4:26b', status: 'contributed', contribution: 1 },
              { run: 2, provider: 'ollama', model: 'qwen2.5:14b', status: 'rejected', contribution: 0 },
              { run: 3, provider: 'ollama', model: 'gemma4:26b', status: 'contributed', contribution: 1 },
            ],
          },
        } as any,
        { id: 'step-2', agent: 'database', status: 'completed', duration: 12 },
        { id: 'step-3', agent: 'writer', status: 'completed', duration: 20 },
      ],
      edges: [
        { from: 'step-1', to: 'step-3', type: 'planned' },
        { from: 'step-2', to: 'step-3', type: 'planned' },
      ],
    };

    const lines = renderSimplifiedGraph(dag);
    const rendered = lines.join('\n');

    expect(lines).toContain('Stage 1 (concurrent):');
    expect(lines).toContain('Stage 2 (sequence):');
    expect(rendered).toContain('step-3 [writer] completed | inputs: step-1, step-2');
    expect(rendered).toContain('consensus 3x exact-majority');
    expect(rendered).toContain('ollama/gemma4:26b r1 contributed 100%');
    expect(rendered).toContain('ollama/qwen2.5:14b r2 rejected 0%');
    expect(rendered).toContain('Connections:');
    expect(rendered).toContain('step-1 -> step-3 (planned)');
  });

});
