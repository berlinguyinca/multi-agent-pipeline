import { describe, expect, it } from 'vitest';
import { formatMapOutput, parseMapOutputFormat } from '../../src/output/result-format.js';

const result = {
  version: 2,
  success: true,
  outcome: 'success',
  dag: {
    nodes: [
      { id: 'step-1', agent: 'researcher', status: 'completed', duration: 1 },
      { id: 'step-2', agent: 'writer', status: 'completed', duration: 1, final: true },
    ],
    edges: [{ from: 'step-1', to: 'step-2', type: 'planned' }],
  },
  steps: [
    { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', output: 'Raw research' },
    { id: 'step-2', agent: 'writer', task: 'Write', status: 'completed', output: 'Final answer' },
  ],
};

describe('extended result formats', () => {
  it('accepts json, yaml, markdown, html, text, and pdf formats', () => {
    expect(parseMapOutputFormat('json')).toBe('json');
    expect(parseMapOutputFormat('yaml')).toBe('yaml');
    expect(parseMapOutputFormat('markdown')).toBe('markdown');
    expect(parseMapOutputFormat('html')).toBe('html');
    expect(parseMapOutputFormat('text')).toBe('text');
    expect(parseMapOutputFormat('pdf')).toBe('pdf');
  });

  it('does not accept compact as an output format', () => {
    expect(() => parseMapOutputFormat('compact')).toThrow('json, yaml, markdown, html, text, pdf');
  });

  it('renders full html output', () => {
    const output = formatMapOutput(result, 'html');

    expect(output).toContain('<!doctype html>');
    expect(output).toContain('<h2>Agent Graph</h2>');
    expect(output).toContain('step-1 [researcher] -&gt; step-2 [writer]');
    expect(output).toContain('<h2>Final Result</h2>');
    expect(output).toContain('Final answer');
    expect(output).toContain('<h2>Result Data</h2>');
  });

  it('renders full plain text output', () => {
    const output = formatMapOutput(result, 'text');

    expect(output).toContain('MAP Result');
    expect(output).toContain('Agent Graph');
    expect(output).toContain('step-1 [researcher] -> step-2 [writer]');
    expect(output).toContain('Final Result');
    expect(output).toContain('Final answer');
  });

  it('renders compact json independently of output format compact shortcut', () => {
    const output = formatMapOutput(result, 'json', { compact: true });
    const parsed = JSON.parse(output) as { agentGraph: string[]; finalResult: string; steps?: unknown };

    expect(parsed).toEqual({
      success: true,
      outcome: 'success',
      agentGraph: ['step-1 [researcher] -> step-2 [writer]'],
      finalResult: 'Final answer',
    });
    expect(parsed.steps).toBeUndefined();
  });

  it('renders compact markdown when compact is requested with markdown format', () => {
    const output = formatMapOutput(result, 'markdown', { compact: true });

    expect(output).toContain('# MAP Compact Result');
    expect(output).toContain('## Agent Graph');
    expect(output).toContain('## Final Result');
    expect(output).not.toContain('## Result Data');
    expect(output).not.toContain('Raw research');
  });

  it('strips LaTeX chemistry notation from non-html output formats', () => {
    const chemistry = {
      version: 2,
      success: true,
      steps: [
        {
          id: 'step-1',
          agent: 'researcher',
          task: 'Research alanine',
          status: 'completed',
          output: 'Alanine ($\\text{C}_3\\text{H}_7\\text{NO}_2$) is an $\\alpha$-amino acid with $\\text{NH}_2$.',
        },
      ],
    };

    const markdown = formatMapOutput(chemistry, 'markdown');
    const text = formatMapOutput(chemistry, 'text');
    const json = formatMapOutput(chemistry, 'json', { compact: true });

    expect(markdown).toContain('Alanine (C3H7NO2) is an alpha-amino acid with NH2.');
    expect(text).toContain('Alanine (C3H7NO2) is an alpha-amino acid with NH2.');
    expect(json).toContain('C3H7NO2');
    expect(markdown).not.toContain('\\text');
    expect(text).not.toContain('\\text');
  });

  it('preserves LaTeX chemistry notation in html output', () => {
    const chemistry = {
      version: 2,
      success: true,
      steps: [
        {
          id: 'step-1',
          agent: 'researcher',
          task: 'Research alanine',
          status: 'completed',
          output: 'Alanine ($\\text{C}_3\\text{H}_7\\text{NO}_2$).',
        },
      ],
    };

    const html = formatMapOutput(chemistry, 'html');

    expect(html).toContain('\\text{C}_3');
  });


  it('includes errors in compact markdown output', () => {
    const failed = {
      version: 2,
      success: false,
      outcome: 'failed',
      error: 'Router failed',
      dag: { nodes: [], edges: [] },
      steps: [
        { id: 'step-1', agent: 'researcher', task: 'Research', status: 'failed', error: 'Model timed out' },
        { id: 'step-2', agent: 'writer', task: 'Write', status: 'skipped', reason: 'Dependency failed: step-1' },
      ],
    };

    const output = formatMapOutput(failed, 'markdown', { compact: true });

    expect(output).toContain('## Errors');
    expect(output).toContain('Router failed');
    expect(output).toContain('step-1 [researcher]: Model timed out');
    expect(output).toContain('step-2 [writer]: Dependency failed: step-1');
  });

  it('includes errors in compact json output', () => {
    const failed = {
      version: 2,
      success: false,
      outcome: 'failed',
      error: 'Router failed',
      steps: [{ id: 'step-1', agent: 'researcher', task: 'Research', status: 'failed', error: 'Model timed out' }],
    };

    const parsed = JSON.parse(formatMapOutput(failed, 'json', { compact: true })) as { errors?: string[] };

    expect(parsed.errors).toEqual(['Router failed', 'step-1 [researcher]: Model timed out']);
  });


  it('includes non-blocking handoff warnings in compact markdown output', () => {
    const warned = {
      version: 2,
      success: true,
      outcome: 'success',
      steps: [
        {
          id: 'step-1-grammar-1',
          agent: 'grammar-spelling-specialist',
          task: 'Polish',
          status: 'completed',
          handoffPassed: true,
          handoffFindings: [
            { severity: 'medium', sourceStepId: 'step-1-grammar-1', message: 'Grammar-polished output changed Markdown/list structure.' },
          ],
          output: 'Polished result',
        },
      ],
    };

    const output = formatMapOutput(warned, 'markdown', { compact: true });

    expect(output).toContain('## Warnings');
    expect(output).toContain('step-1-grammar-1 [grammar-spelling-specialist]: Grammar-polished output changed Markdown/list structure.');
    expect(output).toContain('## Final Result');
  });


  it('compact markdown prioritizes useful final result before graph and falls back from internal tool tables', () => {
    const degraded = {
      version: 2,
      success: true,
      outcome: 'success',
      dag: {
        nodes: [
          { id: 'step-1', agent: 'classyfire-taxonomy-classifier', status: 'completed', duration: 1 },
          { id: 'step-2', agent: 'usage-classification-tree', status: 'completed', duration: 1 },
          { id: 'step-3', agent: 'output-formatter', status: 'completed', duration: 1, final: true },
        ],
        edges: [
          { from: 'step-1', to: 'step-2', type: 'planned' },
          { from: 'step-2', to: 'step-3', type: 'planned' },
        ],
      },
      steps: [
        { id: 'step-1', agent: 'classyfire-taxonomy-classifier', task: 'Classify', status: 'completed', output: 'ClassyFire tree' },
        { id: 'step-2', agent: 'usage-classification-tree', task: 'Usage', status: 'completed', output: '# Usage Classification Tree\n\nEntity: test\n\n## Usage Tree\n\n| Level | Usage Classification |\n| --- | --- |\n| Level 1 | Biomarker |' },
        { id: 'step-3', agent: 'output-formatter', task: 'Format', status: 'completed', output: '| Agent | Tool | Parameter |\n| :--- | :--- | :--- |\n| grammar-spelling-specialist | web-search | test |' },
      ],
    };

    const output = formatMapOutput(degraded, 'markdown', { compact: true });

    expect(output.indexOf('## Final Result')).toBeLessThan(output.indexOf('## Agent Graph'));
    expect(output).toContain('# Usage Classification Tree');
    expect(output).toContain('Biomarker');
    expect(output).not.toContain('grammar-spelling-specialist | web-search');
  });


  it('compact markdown falls back from lossy formatter tables to richer upstream report', () => {
    const lossy = {
      version: 2,
      success: true,
      outcome: 'success',
      dag: {
        nodes: [
          { id: 'step-1', agent: 'classyfire-taxonomy-classifier', status: 'completed', duration: 1 },
          { id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', status: 'completed', duration: 1 },
          { id: 'step-2', agent: 'usage-classification-tree', status: 'completed', duration: 1 },
          { id: 'step-2-grammar-1', agent: 'grammar-spelling-specialist', status: 'completed', duration: 1 },
          { id: 'step-3', agent: 'output-formatter', status: 'completed', duration: 1, final: true },
        ],
        edges: [
          { from: 'step-1', to: 'step-1-grammar-1', type: 'planned' },
          { from: 'step-1-grammar-1', to: 'step-2', type: 'planned' },
          { from: 'step-2', to: 'step-2-grammar-1', type: 'planned' },
          { from: 'step-2-grammar-1', to: 'step-3', type: 'planned' },
        ],
      },
      steps: [
        { id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', task: 'Classify', status: 'completed', output: '# ClassyFire / ChemOnt Taxonomic Classification\n\nCompound: X\n\n## Taxonomy Tree\n\n| Rank | Classification |\n| --- | --- |\n| Kingdom | Organic compounds |\n| Superclass | Organic acids and derivatives |' },
        { id: 'step-2-grammar-1', agent: 'grammar-spelling-specialist', task: 'Usage', status: 'completed', output: '# Usage Classification Tree\n\nEntity: X\n\n## Usage Tree\n\n### Tree 1: Metabolomics and Biomarker Identification\n\n| Level | Usage Classification |\n| --- | --- |\n| Level 1 | Secondary metabolite |\n| Level 2 | Phenolic glycoside |\n| Level 3 | Phenylpropanoid-derived metabolite |\n| Level 4 | Analytical target (Metabolomics) |\n\n## Notes\n\n- Useful metabolomics caveat.' },
        { id: 'step-3', agent: 'output-formatter', task: 'Format XLS cells', status: 'completed', output: '| Entity | Usage Domain | Source Method | Confidence | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 | Level 6 |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n| X | research | evidence-backed inference | medium | Metabolite | Secondary metabolite | Metabolic biomarker | Metabolic profiling | unavailable | unavailable |' },
      ],
    };

    const output = formatMapOutput(lossy, 'markdown', { compact: true });

    expect(output).toContain('# Usage Classification Tree');
    expect(output).toContain('Phenolic glycoside');
    expect(output).toContain('Useful metabolomics caveat');
    expect(output).not.toContain('| Entity | Usage Domain | Source Method | Confidence |');
  });


  it('compact markdown combines taxonomy and usage reports instead of dropping the taxonomy branch', () => {
    const combined = {
      version: 2,
      success: true,
      outcome: 'success',
      dag: {
        nodes: [
          { id: 'step-1', agent: 'classyfire-taxonomy-classifier', status: 'completed', duration: 1 },
          { id: 'step-2', agent: 'usage-classification-tree', status: 'completed', duration: 1 },
          { id: 'step-3', agent: 'output-formatter', status: 'failed', duration: 1, final: true },
        ],
        edges: [
          { from: 'step-1', to: 'step-2', type: 'planned' },
          { from: 'step-2', to: 'step-3', type: 'planned' },
        ],
      },
      steps: [
        { id: 'step-1', agent: 'classyfire-taxonomy-classifier', task: 'Classify', status: 'completed', output: '# ClassyFire / ChemOnt Taxonomic Classification\n\nCompound: X\n\n## Taxonomy Tree\n\n| Rank | Classification |\n| --- | --- |\n| Kingdom | Organic compounds |\n| Superclass | Organic oxygen compounds |' },
        { id: 'step-2', agent: 'usage-classification-tree', task: 'Usage', status: 'completed', output: '# Usage Classification Tree\n\nEntity: X\n\n## Usage Tree\n\n| Level | Usage Classification |\n| --- | --- |\n| Level 1 | Biomarker |' },
        { id: 'step-3', agent: 'output-formatter', task: 'Format', status: 'failed', error: 'Formatter dropped required sections or labels: Usage Classification Tree, Usage Tree' },
      ],
    };

    const output = formatMapOutput(combined, 'markdown', { compact: true });

    expect(output).toContain('# ClassyFire / ChemOnt Taxonomic Classification');
    expect(output).toContain('## Taxonomy Tree');
    expect(output).toContain('Organic compounds');
    expect(output).toContain('# Usage Classification Tree');
    expect(output).toContain('## Usage Tree');
    expect(output).toContain('Biomarker');
  });

  it('compact html and pdf use combined taxonomy and usage outputs instead of terminal judge text', () => {
    const judged = {
      version: 2,
      success: true,
      outcome: 'success',
      dag: {
        nodes: [
          { id: 'step-1', agent: 'classyfire-taxonomy-classifier', status: 'completed', duration: 1 },
          { id: 'step-2', agent: 'usage-classification-tree', status: 'completed', duration: 1 },
          { id: 'step-3', agent: 'result-judge', status: 'completed', duration: 1, final: true },
        ],
        edges: [
          { from: 'step-1', to: 'step-3', type: 'planned' },
          { from: 'step-2', to: 'step-3', type: 'planned' },
        ],
      },
      steps: [
        { id: 'step-1', agent: 'classyfire-taxonomy-classifier', task: 'Classify', status: 'completed', output: '# ClassyFire / ChemOnt Taxonomic Classification\n\nCompound: X\n\n## Taxonomy Tree\n\n| Rank | Classification |\n| --- | --- |\n| Kingdom | Organic compounds |' },
        { id: 'step-2', agent: 'usage-classification-tree', task: 'Usage', status: 'completed', output: '# Usage Classification Tree\n\nEntity: X\n\n## Usage Tree\n\n| Level | Usage Classification |\n| --- | --- |\n| Level 1 | Biomarker |' },
        { id: 'step-3', agent: 'result-judge', task: 'Judge', status: 'completed', output: 'Please provide candidate outputs to judge.' },
      ],
    };

    for (const format of ['html', 'pdf'] as const) {
      const output = formatMapOutput(judged, format, { compact: true });

      expect(output).toContain('ClassyFire / ChemOnt Taxonomic Classification');
      expect(output).toContain('Usage Classification Tree');
      expect(output).not.toContain('Please provide candidate outputs to judge');
    }
  });

  it('compact html combines grammar-polished taxonomy and usage outputs without selecting judge rubric text', () => {
    const judged = {
      version: 2,
      success: true,
      outcome: 'success',
      dag: {
        nodes: [
          { id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', status: 'completed', duration: 1 },
          { id: 'step-2-grammar-1', agent: 'grammar-spelling-specialist', status: 'completed', duration: 1 },
          { id: 'step-3', agent: 'result-judge', status: 'completed', duration: 1, final: true },
        ],
        edges: [
          { from: 'step-1-grammar-1', to: 'step-3', type: 'planned' },
          { from: 'step-2-grammar-1', to: 'step-3', type: 'planned' },
        ],
      },
      steps: [
        { id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', task: 'Polish taxonomy', status: 'completed', output: '# ClassyFire / ChemOnt Taxonomic Classification\n\nCompound: X\n\n## Taxonomy Tree\n\n| Rank | Classification |\n| --- | --- |\n| Kingdom | Organic compounds |' },
        { id: 'step-2-grammar-1', agent: 'grammar-spelling-specialist', task: 'Polish usage', status: 'completed', output: '# Usage Classification Tree\n\nEntity: X\n\n## LCB Exposure Summary\n\n| Category | Classification |\n| --- | --- |\n| Drug / drug metabolite | no |' },
        { id: 'step-3', agent: 'result-judge', task: 'Judge', status: 'completed', output: 'The provided context contains two distinct datasets: a chemical taxonomy (ClassyFire) and a usage classification (LCB). Please provide candidate outputs to judge.' },
      ],
    };

    const output = formatMapOutput(judged, 'html', { compact: true });

    expect(output).toContain('ClassyFire / ChemOnt Taxonomic Classification');
    expect(output).toContain('Taxonomy Tree');
    expect(output).toContain('Usage Classification Tree');
    expect(output).toContain('LCB Exposure Summary');
    expect(output).not.toContain('Please provide candidate outputs to judge');
  });

  it('compact markdown falls back from formatter data-unavailable tables to useful taxonomy output', () => {
    const degraded = {
      version: 2,
      success: false,
      outcome: 'failed',
      dag: {
        nodes: [
          { id: 'step-1', agent: 'classyfire-taxonomy-classifier', status: 'completed', duration: 1 },
          { id: 'organize-step-2', agent: 'usage-classification-tree', status: 'failed', duration: 1 },
          { id: 'format-step-3', agent: 'output-formatter', status: 'completed', duration: 1, final: true },
        ],
        edges: [
          { from: 'step-1', to: 'organize-step-2', type: 'planned' },
        ],
      },
      steps: [
        { id: 'step-1', agent: 'classyfire-taxonomy-classifier', task: 'Classify', status: 'completed', output: '# ClassyFire / ChemOnt Taxonomic Classification\n\nCompound: Alanine\n\n## Taxonomy Tree\n\n| Rank | Classification |\n| --- | --- |\n| Kingdom | Organic compounds |' },
        { id: 'organize-step-2', agent: 'usage-classification-tree', task: 'Usage', status: 'failed', error: 'Step timed out during organize-step-2 (usage-classification-tree)' },
        { id: 'format-step-3', agent: 'output-formatter', task: 'Format', status: 'completed', output: '| Parameter | Result |\n| :--- | :--- |\n| Subject | alanine |\n| Retrieval Result | No matching knowledge entries found |\n| Status | Data Unavailable |' },
      ],
    };

    const output = formatMapOutput(degraded, 'markdown', { compact: true });

    expect(output).toContain('# ClassyFire / ChemOnt Taxonomic Classification');
    expect(output).toContain('Alanine');
    expect(output).not.toContain('Data Unavailable');
    expect(output).not.toContain('No matching knowledge entries found');
  });

});
