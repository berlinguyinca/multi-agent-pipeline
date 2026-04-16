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

    expect(renderSimplifiedGraph(dag)).toEqual([
      'step-1 [researcher] --handoff--> step-1-grammar-1 [grammar-spelling-specialist]',
      'step-1-grammar-1 [grammar-spelling-specialist] -> step-2 [implementation-coder]',
      'step-2 [implementation-coder] --recovery--> step-2-recovery-1 [build-fixer]',
      'step-2-recovery-1 [build-fixer] -> step-2-retry-1 [implementation-coder]',
    ]);
  });
});
