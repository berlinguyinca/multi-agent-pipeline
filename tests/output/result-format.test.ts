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

  it('adds missing positive LCB exposure categories to Usage Commonness Ranking', () => {
    const output = formatMapOutput({
      version: 2,
      success: true,
      dag: {
        nodes: [{ id: 'step-1', agent: 'usage-classification-tree', status: 'completed', duration: 1 }],
        edges: [],
      },
      steps: [{
        id: 'step-1',
        agent: 'usage-classification-tree',
        task: 'Classify usage',
        status: 'completed',
        output: [
          '# Usage Classification Tree',
          '',
          '## LCB Exposure Summary',
          '',
          '| Category | Is this category applicable? | Typical examples when applicable | Evidence/caveat |',
          '| --- | --- | --- | --- |',
          '| drug / drug metabolite | yes | topical anesthesia | supported medical use |',
          '| other exposure origins | yes | forensic toxicology; workplace testing | supported exposure-origin reporting |',
          '| pesticide | no | unavailable | unavailable |',
          '',
          '## Usage Commonness Ranking',
          '',
          '| Rank | Usage/application/exposure origin | Category | Commonness score | Commonness label | Commonness timeframe | Recency/currentness evidence | Evidence/caveat |',
          '| --- | --- | --- | --- | --- | --- | --- | --- |',
          '| 1 | topical anesthesia | drug / drug metabolite | 30 | less common | current | restricted current use | supported medical use |',
          '',
          '## Usage Tree',
          '',
          '| Level | Usage Classification |',
          '| --- | --- |',
          '| Level 1 | Medical and analytical applications |',
        ].join('\n'),
      }],
    }, 'pdf');

    expect(output).toMatch(/<td>2<\/td>\s*<td>forensic toxicology<\/td>\s*<td>other exposure origins<\/td>\s*<td>unavailable<\/td>/);
    expect(output).toMatch(/<td>3<\/td>\s*<td>workplace testing<\/td>\s*<td>other exposure origins<\/td>\s*<td>unavailable<\/td>/);
    expect(output).toContain('reported usage scenario; commonness scoring evidence unavailable');
  });

  it('adds a commonness ranking row for each reported usage scenario', () => {
    const output = formatMapOutput({
      version: 2,
      success: true,
      dag: { nodes: [{ id: 'step-1', agent: 'usage-classification-tree', status: 'completed', duration: 1 }], edges: [] },
      steps: [{
        id: 'step-1',
        agent: 'usage-classification-tree',
        task: 'Classify cocaine usage',
        status: 'completed',
        output: [
          '# Usage Classification Tree',
          '',
          '## LCB Exposure Summary',
          '',
          '| Category | Is this category applicable? | Typical examples when applicable | Evidence/caveat |',
          '| --- | --- | --- | --- |',
          '| drug / drug metabolite | yes | local anesthesia; otorhinolaryngological surgery; diagnostic procedures | cocaine hydrochloride used as local anesthetic and vasoconstrictor |',
          '| other exposure origins | yes | forensic toxicology; drug abuse monitoring; urine drug screening | detection of metabolites like benzoylecgonine in urine |',
          '',
          '## Usage Commonness Ranking',
          '',
          '| Rank | Usage/application/exposure origin | Category | Commonness score | Commonness label | Commonness timeframe | Recency/currentness evidence | Evidence/caveat |',
          '| --- | --- | --- | --- | --- | --- | --- | --- |',
          '| 1 | Forensic toxicology/drug monitoring | other exposure origins | 60 | less common | current | widespread use in drug screening/metabolomics | used for identifying exposure via metabolites |',
          '| 2 | Local anesthesia (ENT/Ophthalmology) | drug / drug metabolite | 45 | less common | current | documented decline in US medical use | usage is specialized and declining |',
          '',
          '## Usage Tree',
          '',
          '| Level | Usage Classification |',
          '| --- | --- |',
          '| Level 1 | Medical and Forensic Applications |',
          '| Level 2.1 | Clinical Pharmacology |',
          '| Level 3.1 | Local Anesthesia |',
          '| Level 4.1 | Otorhinolaryngological surgery |',
          '| Level 4.2 | Diagnostic procedures |',
          '| Level 2.2 | Clinical Toxicology |',
          '| Level 3.2 | Biomarker Identification |',
          '| Level 4.3 | Metabolite detection (e.g., benzoylecgonine) |',
        ].join('\n'),
      }],
    }, 'pdf');

    for (const scenario of [
      'otorhinolaryngological surgery',
      'diagnostic procedures',
      'drug abuse monitoring',
      'urine drug screening',
      'Biomarker Identification',
      'Metabolite detection (e.g., benzoylecgonine)',
    ]) {
      expect(output).toContain(`<td>${scenario}</td>`);
    }
    expect(output).toContain('reported usage scenario; commonness scoring evidence unavailable');
  });

  it('deduplicates repeated Usage Tree row identifiers in customer-facing output', () => {
    const output = formatMapOutput({
      version: 2,
      success: true,
      dag: {
        nodes: [{ id: 'step-1', agent: 'usage-classification-tree', status: 'completed', duration: 1 }],
        edges: [],
      },
      steps: [{
        id: 'step-1',
        agent: 'usage-classification-tree',
        task: 'Classify usage',
        status: 'completed',
        output: [
          '# Usage Classification Tree',
          '',
          '## Usage Tree',
          '',
          '| Level | Usage Classification |',
          '| --- | --- |',
          '| Level 1 | Medical applications |',
          '| Level 2 | Local anesthesia |',
          '| Level 3 | Nasal mucosa |',
          '| Level 2 | Analytical use |',
          '| Level 3 | Toxicology biomarker |',
        ].join('\n'),
      }],
    }, 'pdf');

    expect(output).toMatch(/<td>Level 2\.1<\/td>\s*<td>Local anesthesia<\/td>/);
    expect(output).toMatch(/<td>Level 2\.2<\/td>\s*<td>Analytical use<\/td>/);
    expect(output).toMatch(/<td>Level 3\.1<\/td>\s*<td>Nasal mucosa<\/td>/);
    expect(output).toMatch(/<td>Level 3\.2<\/td>\s*<td>Toxicology biomarker<\/td>/);
    expect(output).not.toMatch(/<td>Level 2<\/td>\s*<td>Local anesthesia<\/td>/);
    expect(output).not.toMatch(/<td>Level 2<\/td>\s*<td>Analytical use<\/td>/);
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

  it('hides superseded evidence failures once an automatic retry passes', () => {
    const output = formatMapOutput({
      version: 2,
      success: true,
      dag: {
        nodes: [
          { id: 'step-1', agent: 'usage-classification-tree', status: 'recovered', duration: 1 },
          { id: 'step-1-evidence-feedback-1', agent: 'researcher', status: 'completed', duration: 1 },
          { id: 'step-1-retry-1', agent: 'usage-classification-tree', status: 'completed', duration: 1 },
        ],
        edges: [
          { from: 'step-1', to: 'step-1-evidence-feedback-1', type: 'feedback' },
          { from: 'step-1-evidence-feedback-1', to: 'step-1-retry-1', type: 'planned' },
          { from: 'step-1', to: 'step-1-retry-1', type: 'recovery' },
        ],
      },
      steps: [
        {
          id: 'step-1',
          agent: 'usage-classification-tree',
          task: 'Classify usage',
          status: 'recovered',
          error: 'claim-1: High commonness scores require current/recent prevalence evidence.',
          replacementStepId: 'step-1-retry-1',
          evidenceGate: {
            checked: true,
            passed: false,
            claims: [{
              id: 'claim-1',
              claim: 'Unsupported high commonness.',
              claimType: 'commonness-score',
              confidence: 'high',
              evidence: [{ sourceType: 'model-prior', title: 'model prior', summary: 'memory only', supports: 'unsupported commonness' }],
            }],
            findings: [{ severity: 'high', claimId: 'claim-1', message: 'High commonness scores require current/recent prevalence evidence.' }],
          },
        },
        { id: 'step-1-evidence-feedback-1', agent: 'researcher', task: 'Gather evidence', status: 'completed', output: 'Evidence feedback' },
        {
          id: 'step-1-retry-1',
          agent: 'usage-classification-tree',
          task: 'Classify usage',
          status: 'completed',
          output: 'Verified usage',
          evidenceGate: {
            checked: true,
            passed: true,
            claims: [{
              id: 'claim-1',
              claim: 'Verified restricted current usage.',
              claimType: 'commonness-score',
              confidence: 'medium',
              evidence: [{ sourceType: 'url', title: 'current source', retrievedAt: '2026-04-19', summary: 'current restricted use', supports: 'current restricted use' }],
            }],
            findings: [],
          },
        },
      ],
    }, 'pdf');

    expect(output).toContain('<h2>Evidence Verification</h2>');
    expect(output).toContain('1 supported / 1 total claims');
    expect(output).toContain('<td>step-1-retry-1</td><td>usage-classification-tree</td><td>pass</td>');
    expect(output).not.toContain('High commonness scores require current/recent prevalence evidence.');
    expect(output).not.toContain('<td>step-1</td><td>usage-classification-tree</td><td>fail</td><td>claim-1</td>');
  });

  it('renders feedback-loop edges in the pipeline graph', () => {
    const output = formatMapOutput({
      version: 2,
      success: true,
      dag: {
        nodes: [
          { id: 'step-1', agent: 'usage-classification-tree', status: 'recovered', duration: 1 },
          { id: 'step-1-evidence-feedback-1', agent: 'researcher', status: 'completed', duration: 1 },
          { id: 'step-1-retry-1', agent: 'usage-classification-tree', status: 'completed', duration: 1 },
        ],
        edges: [
          { from: 'step-1', to: 'step-1-evidence-feedback-1', type: 'feedback' },
          { from: 'step-1-evidence-feedback-1', to: 'step-1-retry-1', type: 'planned' },
          { from: 'step-1', to: 'step-1-retry-1', type: 'recovery' },
        ],
      },
      steps: [
        { id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', status: 'recovered', error: 'Evidence gate failed' },
        { id: 'step-1-evidence-feedback-1', agent: 'researcher', task: 'Gather evidence', status: 'completed', output: 'Evidence feedback' },
        { id: 'step-1-retry-1', agent: 'usage-classification-tree', task: 'Classify usage', status: 'completed', output: 'Verified usage' },
      ],
    }, 'markdown');

    expect(output).toContain('step-1 [usage-classification-tree] recovered');
    expect(output).toContain('step-1 --feedback--> step-1-evidence-feedback-1');
    expect(output).toContain('step-1 --recovery--> step-1-retry-1');
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

  it('renders autonomous agent discovery diagnostics', () => {
    const output = formatMapOutput({
      version: 2,
      success: true,
      agentDiscovery: [{
        status: 'created',
        suggestedAgent: { name: 'invoice-analysis-specialist', description: 'Analyze invoice anomalies' },
        reason: 'No enabled invoice specialist exists.',
        generatedPath: '/repo/agents/invoice-analysis-specialist',
        model: {
          selected: { model: 'qwen2.5:7b', reason: 'estimated 5.0GB fits within 16.0GB per loaded model' },
          candidates: [],
          rejected: [{ model: 'giant:70b', reason: 'estimated 49.0GB exceeds 16.0GB per loaded model' }],
          hardware: { totalMemoryGb: 32, usableMemoryGb: 16, maxLoadedModels: 2, numParallel: 1 },
        },
        consensus: {
          method: 'three-candidates-local-judge',
          selectedCandidate: 2,
          candidates: [
            { run: 1, name: 'invoice-generalist', status: 'valid', score: 10, reason: 'lower overlap' },
            { run: 2, name: 'invoice-analysis-specialist', status: 'valid', score: 70, reason: 'best overlap' },
          ],
        },
        warnings: [],
      }],
      dag: { nodes: [], edges: [] },
      steps: [],
    }, 'markdown');

    expect(output).toContain('## Autonomous Agent Discovery');
    expect(output).toContain('| invoice-analysis-specialist | created | qwen2.5:7b | 2 | /repo/agents/invoice-analysis-specialist |');
    expect(output).toContain('giant:70b');
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
