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
      {
        id: 'step-1',
        agent: 'researcher',
        task: 'Research',
        status: 'completed',
        output: 'Raw research',
        handoffPassed: true,
        specConformance: { checked: false, passed: true, missingCriteria: [], notes: [] },
        consensus: {
          enabled: true,
          runs: 3,
          candidateCount: 3,
          selectedRun: 1,
          agreement: 2 / 3,
          method: 'exact-majority',
          participants: [
            { run: 1, provider: 'ollama', model: 'gemma4:26b', status: 'contributed', contribution: 1 },
            { run: 2, provider: 'ollama', model: 'gemma4:26b', status: 'rejected', contribution: 0 },
            { run: 3, provider: 'ollama', model: 'gemma4:26b', status: 'contributed', contribution: 1 },
          ],
        },
      },
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
    expect(output).toContain('| step-1 | researcher | completed | pass | not checked | Research |');
    expect(output).toContain('## Consensus Diagnostics');
    expect(output).toContain('| step-1 | researcher | exact-majority | 1 | ollama/gemma4:26b | contributed | 100% |');
  });

  it('accepts pdf as a print-oriented HTML output format', () => {
    const output = formatMapOutput(result, 'pdf');

    expect(output).toContain('<!doctype html>');
    expect(output).toContain('<h2>Final Result</h2>');
    expect(output).toContain('Final polished answer');
  });

  it('renders a visual agent network in html output', () => {
    const output = formatMapOutput(result, 'html');

    expect(output).toContain('Agent Network');
    expect(output).toContain('class="agent-network"');
    expect(output).toContain('class="agent-node completed"');
    expect(output).toContain('class="flow-arrow"');
    expect(output).toContain('step-1 -&gt; step-1-grammar-1');
  });

  it('renders markdown final results as html instead of preformatted text', () => {
    const markdownResult = {
      ...result,
      steps: [
        { id: 'step-1', agent: 'writer', task: 'Write', status: 'completed', output: '# Report\n\n| A | B |\n| --- | --- |\n| one | two |' },
      ],
      dag: {
        nodes: [{ id: 'step-1', agent: 'writer', status: 'completed', duration: 1 }],
        edges: [],
      },
    };

    const output = formatMapOutput(markdownResult, 'html');

    expect(output).toContain('<article class="rendered-markdown">');
    expect(output).toContain('<h1>Report</h1>');
    expect(output).toContain('<table>');
    expect(output).not.toContain('&lt;table&gt;');
  });

  it('prints compact output with only simplified graph and final result', () => {
    const output = formatCompactMapOutput(result);

    expect(output).toContain('# MAP Compact Result');
    expect(output).toContain('## Agent Graph');
    expect(output).toContain('step-1-grammar-1 [grammar-spelling-specialist] -> step-2 [writer]');
    expect(output).toContain('## Consensus Diagnostics');
    expect(output).toContain('step-1 [researcher] exact-majority: ollama/gemma4:26b run 1 contributed 100%');
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
