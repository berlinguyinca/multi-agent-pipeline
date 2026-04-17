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
    expect(output).toContain('Stage 1 (sequence):');
    expect(output).toContain('step-1 [researcher] completed | consensus 3x exact-majority');
    expect(output).toContain('step-1 -> step-1-grammar-1 (planned)');
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


  it('renders a compact layered HTML flowchart with consensus run models', () => {
    const branched = {
      ...result,
      dag: {
        nodes: [
          { id: 'step-1', agent: 'researcher', status: 'completed', duration: 10 },
          { id: 'step-2', agent: 'data-loader', status: 'completed', duration: 12 },
          { id: 'step-3', agent: 'writer', status: 'completed', duration: 8 },
        ],
        edges: [
          { from: 'step-1', to: 'step-3', type: 'planned' },
          { from: 'step-2', to: 'step-3', type: 'planned' },
        ],
      },
      steps: [
        result.steps[0],
        { id: 'step-2', agent: 'data-loader', task: 'Load data', status: 'completed', output: 'Data' },
        { id: 'step-3', agent: 'writer', task: 'Write', status: 'completed', output: 'Final polished answer', dependsOn: ['step-1', 'step-2'] },
      ],
    };

    const output = formatMapOutput(branched, 'html');

    expect(output).toContain('class="agent-stage concurrent"');
    expect(output).toContain('class="agent-stage sequence"');
    expect(output).toContain('step-3 inputs: step-1, step-2');
    expect(output).toContain('Consensus: 3x exact-majority');
    expect(output).toContain('ollama/gemma4:26b r1 contributed 100%');
    expect(output).toContain('class="agent-edge planned"');
  });




  it('can force metro and cluster HTML DAG layouts', () => {
    const metro = formatMapOutput(result, 'html', { dagLayout: 'metro' });
    const cluster = formatMapOutput(result, 'html', { dagLayout: 'cluster' });

    expect(metro).toContain('class="agent-metro-network"');
    expect(metro).toContain('Agent Metro');
    expect(metro).toContain('metro-stop');
    expect(cluster).toContain('class="agent-cluster-network"');
    expect(cluster).toContain('Agent Clusters');
    expect(cluster).toContain('cluster-chip');
  });


  it('uses matrix lanes for large HTML agent networks', () => {
    const nodes = Array.from({ length: 13 }, (_, index) => ({
      id: `step-${index + 1}`,
      agent: index % 3 === 0 ? 'researcher' : index % 3 === 1 ? 'implementation-coder' : 'verifier',
      status: 'completed',
      duration: 10 + index,
    }));
    const edges = nodes.slice(1).map((node, index) => ({
      from: `step-${index + 1}`,
      to: node.id,
      type: 'planned',
    }));
    const output = formatMapOutput({
      ...result,
      dag: { nodes, edges },
      steps: nodes.map((node) => ({ ...node, task: `Task ${node.id}`, output: node.id === 'step-13' ? 'Final large answer' : `Output ${node.id}` })),
    }, 'html');

    expect(output).toContain('class="agent-matrix-network"');
    expect(output).toContain('Agent Matrix');
    expect(output).toContain('Role / Stage');
    expect(output).toContain('matrix-cell');
    expect(output).not.toContain('class="agent-stage concurrent"');
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


  it('renders pdf HTML without raw Result Data while preserving rendered Markdown', () => {
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

    const output = formatMapOutput(markdownResult, 'pdf');

    expect(output).toContain('<h1>Report</h1>');
    expect(output).toContain('<table>');
    expect(output).not.toContain('<h2>Result Data</h2>');
    expect(output).not.toContain('&quot;output&quot;: &quot;# Report');
  });

  it('prints compact output with only simplified graph and final result', () => {
    const output = formatCompactMapOutput(result);

    expect(output).toContain('# MAP Compact Result');
    expect(output).toContain('## Agent Graph');
    expect(output).toContain('Stage 3 (sequence):');
    expect(output).toContain('step-1-grammar-1 -> step-2 (planned)');
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
