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
  it('accepts json, yaml, markdown, html, and text formats', () => {
    expect(parseMapOutputFormat('json')).toBe('json');
    expect(parseMapOutputFormat('yaml')).toBe('yaml');
    expect(parseMapOutputFormat('markdown')).toBe('markdown');
    expect(parseMapOutputFormat('html')).toBe('html');
    expect(parseMapOutputFormat('text')).toBe('text');
  });

  it('does not accept compact as an output format', () => {
    expect(() => parseMapOutputFormat('compact')).toThrow('json, yaml, markdown, html, text');
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

});
