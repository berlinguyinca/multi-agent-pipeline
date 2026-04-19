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
    const output = formatMapOutput({
      ...result,
      rerun: {
        command: 'map --headless "Build a report"',
        disableAgentFlag: '--disable-agent <agent-name>',
      },
    }, 'markdown');

    expect(output).toContain('## Agent Graph');
    expect(output).toContain('Stage 1 (sequence):');
    expect(output).toContain('step-1 [researcher] completed | consensus 3x exact-majority');
    expect(output).toContain('step-1 -> step-1-grammar-1 (planned)');
    expect(output).toContain('## Final Result');
    expect(output).toContain('Final polished answer');
    expect(output).toContain('| step-1 | researcher | completed | pass | not checked | Research |');
    expect(output).toContain('## Consensus Diagnostics');
    expect(output).toContain('| step-1 | researcher | exact-majority | 1 | ollama/gemma4:26b | contributed | 100% |');
    expect(output).toContain('## Agent Contributions');
    expect(output).toContain('| researcher | 1 | completed | Research |');
    expect(output).toContain('Consensus improved confidence');
    expect(output).toContain('## Rerun and self-optimization');
    expect(output).toContain('map --headless "Build a report" --disable-agent researcher');
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

  it('renders LLM judge panel votes and steering status', () => {
    const output = formatMapOutput({
      ...result,
      judgePanel: {
        enabled: true,
        verdict: 'accept',
        voteCount: 2,
        steeringApplied: true,
        improvements: ['Add verification evidence'],
        rounds: [
          {
            round: 1,
            verdict: 'revise',
            voteCount: 1,
            improvements: ['Add verification evidence'],
            rationale: 'Needs more proof',
            votes: [
              {
                run: 1,
                provider: 'ollama',
                model: 'judge-a',
                verdict: 'revise',
                confidence: 0.8,
                improvements: ['Add verification evidence'],
                rationale: 'Needs more proof',
                shouldSteer: true,
              },
            ],
          },
          {
            round: 2,
            verdict: 'accept',
            voteCount: 1,
            improvements: [],
            rationale: 'Satisfied',
            votes: [
              {
                run: 1,
                provider: 'claude',
                model: 'sonnet',
                verdict: 'accept',
                confidence: 0.9,
                improvements: [],
                rationale: 'Satisfied',
                shouldSteer: false,
              },
            ],
          },
        ],
        votes: [
          {
            run: 1,
            role: 'recency-auditor',
            provider: 'claude',
            model: 'sonnet',
            verdict: 'accept',
            confidence: 0.9,
            improvements: [],
            rationale: 'Satisfied',
            shouldSteer: false,
          },
        ],
      },
    }, 'markdown');

    expect(output).toContain('## LLM Judge Panel');
    expect(output).toContain('- Verdict: accept');
    expect(output).toContain('- Steering applied: yes');
    expect(output).toContain('- Round 1: revise');
    expect(output).toContain('- Round 2: accept');
    expect(output).toContain('| 1 | recency-auditor | sonnet | accept | 90% | no | Satisfied |');
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

  it('reports underperforming agents as self-optimization candidates', () => {
    const output = formatMapOutput({
      version: 2,
      success: false,
      rerun: {
        command: 'map --headless "Build a report"',
        disableAgentFlag: '--disable-agent <agent-name>',
      },
      dag: {
        nodes: [
          { id: 'step-1', agent: 'researcher', status: 'completed', duration: 10 },
          { id: 'step-2', agent: 'writer', status: 'failed', duration: 10 },
        ],
        edges: [{ from: 'step-1', to: 'step-2', type: 'planned' }],
      },
      steps: [
        { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', output: 'Raw research' },
        { id: 'step-2', agent: 'writer', task: 'Write', status: 'failed', error: 'empty output' },
      ],
    }, 'text');

    expect(output).toContain('Agent Contributions');
    expect(output).toContain('- writer: 1 step(s), failed');
    expect(output).toContain('Rerun and self-optimization');
    expect(output).toContain('map --headless "Build a report" --disable-agent writer');
  });

  it('renders evidence gate findings for fact-critical claims', () => {
    const output = formatMapOutput({
      version: 2,
      success: false,
      dag: {
        nodes: [{ id: 'step-1', agent: 'usage-classification-tree', status: 'failed', duration: 1 }],
        edges: [],
      },
      steps: [
        {
          id: 'step-1',
          agent: 'usage-classification-tree',
          task: 'Classify usage',
          status: 'failed',
          error: 'Evidence gate failed',
          evidenceGate: {
            checked: true,
            passed: false,
            claims: [{
              id: 'claim-1',
              claim: 'Historical use is common today',
              claimType: 'commonness-score',
              confidence: 'medium',
              evidence: [{ sourceType: 'document', title: 'Old source', publishedAt: '1820', supports: 'historical use', summary: 'old practice' }],
            }],
            findings: [{ severity: 'high', claimId: 'claim-1', message: 'High commonness scores require current/recent prevalence evidence.' }],
          },
        },
      ],
    }, 'markdown');

    expect(output).toContain('## Evidence Verification');
    expect(output).toContain('- Evidence coverage: 0 supported / 1 total claims');
    expect(output).toContain('| Step | Agent | Status | Claim | Severity | Finding | Sources |');
    expect(output).toContain('| step-1 | usage-classification-tree | fail | claim-1 | high | High commonness scores require current/recent prevalence evidence. | Old source (published 1820) |');
  });

  it('does not render rejected-agent rationale when fallback selected specialized agents', () => {
    const output = formatMapOutput({
      version: 2,
      success: true,
      routerRationale: {
        selectedAgents: [{
          agent: 'usage-classification-tree',
          reason: 'Deterministic domain fallback selected specialized chemical taxonomy/usage agents after the router returned no executable plan.',
        }],
        rejectedAgents: [],
      },
      dag: { nodes: [], edges: [] },
      steps: [],
    }, 'markdown');

    expect(output).toContain('## Router Rationale');
    expect(output).not.toContain('Rejected or skipped agents');
    expect(output).not.toContain('researcher: While capable of research');
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
