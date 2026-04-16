import { describe, expect, it } from 'vitest';
import { formatCompactMapOutput, formatMapOutput } from '../../src/output/result-format.js';

describe('result formatting', () => {
  const result = {
    version: 2,
    success: true,
    dag: {
      nodes: [
        { id: 'step-1', agent: 'researcher', status: 'completed', duration: 10 },
        { id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', status: 'completed', duration: 5 },
        { id: 'step-2', agent: 'writer', status: 'completed', duration: 8 },
      ],
      edges: [
        { from: 'step-1', to: 'step-1-grammar-1', type: 'planned' },
        { from: 'step-1-grammar-1', to: 'step-2', type: 'planned' },
      ],
    },
    steps: [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', output: 'Raw research' },
      { id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', task: 'Polish', status: 'completed', output: 'Polished research' },
      { id: 'step-2', agent: 'writer', task: 'Write', status: 'completed', output: 'Final polished answer' },
    ],
  };

  it('includes a Final Result section in markdown output', () => {
    const output = formatMapOutput(result, 'markdown');

    expect(output).toContain('## Agent Graph');
    expect(output).toContain('step-1 [researcher] -> step-1-grammar-1 [grammar-spelling-specialist]');
    expect(output).toContain('## Final Result');
    expect(output).toContain('Final polished answer');
  });

  it('prints compact output with only simplified graph and final result', () => {
    const output = formatCompactMapOutput(result);

    expect(output).toContain('# MAP Compact Result');
    expect(output).toContain('## Agent Graph');
    expect(output).toContain('step-1-grammar-1 [grammar-spelling-specialist] -> step-2 [writer]');
    expect(output).toContain('## Final Result');
    expect(output).toContain('Final polished answer');
    expect(output).not.toContain('## Result Data');
    expect(output).not.toContain('Raw research');
  });

  it('selects the final result from terminal DAG sinks instead of incidental later branch output', () => {
    const branched = {
      version: 2,
      success: true,
      dag: {
        nodes: [
          { id: 'step-1', agent: 'researcher', status: 'completed', duration: 1 },
          { id: 'step-2', agent: 'writer', status: 'completed', duration: 1 },
          { id: 'step-side', agent: 'docs-maintainer', status: 'completed', duration: 1 },
        ],
        edges: [{ from: 'step-1', to: 'step-2', type: 'planned' }],
      },
      steps: [
        { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', output: 'Research' },
        { id: 'step-2', agent: 'writer', task: 'Final answer', status: 'completed', output: 'True final answer' },
        { id: 'step-side', agent: 'docs-maintainer', task: 'Side docs', status: 'completed', output: 'Incidental side output' },
      ],
    };

    const output = formatCompactMapOutput(branched);

    expect(output).toContain('True final answer');
    expect(output).not.toContain('Incidental side output');
  });


  it('prefers explicit final DAG nodes over terminal sink order', () => {
    const markedFinal = {
      version: 2,
      success: true,
      dag: {
        nodes: [
          { id: 'step-a', agent: 'writer', status: 'completed', duration: 1, final: true },
          { id: 'step-b', agent: 'sidecar', status: 'completed', duration: 1 },
        ],
        edges: [],
      },
      steps: [
        { id: 'step-a', agent: 'writer', task: 'Final answer', status: 'completed', output: 'Explicit final answer' },
        { id: 'step-b', agent: 'sidecar', task: 'Side output', status: 'completed', output: 'Later side output' },
      ],
    };

    const output = formatCompactMapOutput(markedFinal);

    expect(output).toContain('Explicit final answer');
    expect(output).not.toContain('Later side output');
  });

});
