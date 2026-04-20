import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writePdfArtifact } from '../../src/output/pdf-artifact.js';

describe('writePdfArtifact', () => {
  it('writes print-ready HTML even when PDF rendering is unavailable', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-pdf-artifact-'));
    const result = await writePdfArtifact(
      {
        version: 2,
        success: true,
        outputDir,
        dag: {
          nodes: [{ id: 'step-1', agent: 'writer', status: 'completed', duration: 1 }],
          edges: [],
        },
        steps: [{ id: 'step-1', agent: 'writer', task: 'Write', status: 'completed', output: 'Final answer' }],
      },
      { outputDir, renderPdf: false },
    );

    expect(result.htmlPath).toMatch(/map-result-.*\.html$/);
    const html = await fs.readFile(result.htmlPath, 'utf8');
    expect(html).toContain('Final answer');
    expect(html).toContain('@page');
    expect(html).toContain('Pipeline Summary');
    expect(html).toContain('pipeline-summary');
    expect(html).toContain('rendered-markdown');
  });

  it('generates and embeds deterministic visual artifacts for report data', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-pdf-visual-artifact-'));
    const result = await writePdfArtifact(
      {
        version: 2,
        success: true,
        outputDir,
        dag: {
          nodes: [{ id: 'step-1', agent: 'usage-classification-tree', status: 'completed', duration: 1 }],
          edges: [],
        },
        steps: [
          {
            id: 'step-1',
            agent: 'usage-classification-tree',
            task: 'Classify usage',
            status: 'completed',
            output: [
              '# Usage Classification Tree',
              '',
              '## Usage Commonness Ranking',
              '',
              '| Rank | Usage/application/exposure origin | Category | Commonness score | Commonness label | Evidence/caveat |',
              '| --- | --- | --- | --- | --- | --- |',
              '| 1 | Food additive | food compound / food metabolite | 88 | very common | Common food use |',
            ].join('\n'),
          },
        ],
      },
      { outputDir, renderPdf: false },
    );

    const html = await fs.readFile(result.htmlPath, 'utf8');
    expect(html).toContain('Visual Artifacts');
    expect(html).toContain('usage-commonness-ranking.svg');
    expect(await fs.stat(path.join(outputDir, 'usage-commonness-ranking.svg'))).toBeTruthy();
    expect(await fs.stat(path.join(outputDir, 'manifest.json'))).toBeTruthy();
  });


  it('uses a terse print pipeline summary and avoids embedding duplicate or full DAG visuals in PDF HTML', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-pdf-compact-dag-'));
    const nodes = Array.from({ length: 8 }, (_, index) => ({
      id: `step-${index + 1}`,
      agent: index % 2 === 0 ? 'researcher' : 'writer',
      status: 'completed',
      duration: 1,
    }));
    const result = await writePdfArtifact(
      {
        version: 2,
        success: true,
        outputDir,
        dag: {
          nodes,
          edges: nodes.slice(1).map((node, index) => ({ from: `step-${index + 1}`, to: node.id, type: 'planned' })),
        },
        steps: nodes.map((node) => ({ ...node, task: `Task ${node.id}`, output: node.id === 'step-8' ? 'Final answer' : `Output ${node.id}` })),
      },
      { outputDir, renderPdf: false },
    );

    const html = await fs.readFile(result.htmlPath, 'utf8');
    expect(html).toContain('Pipeline Summary');
    expect(html).toContain('8 steps');
    expect(html).toContain('2 agents');
    expect(html).toContain('step-1');
    expect(html).toContain('step-8');
    expect(html).toContain('Agent legend');
    expect(html).toContain('<strong>R</strong> = researcher');
    expect(html).toContain('<strong>W</strong> = writer');
    expect(html).not.toContain('class="agent-matrix-network"');
    expect(html).not.toContain('class="agent-network"');
    expect(html).not.toContain('class="agent-stage sequence"');
    expect(html).not.toContain('<h2>Steps</h2>');
    expect(html).not.toContain('artifacts/agent-network.svg');
    expect(await fs.stat(path.join(outputDir, 'agent-network.svg'))).toBeTruthy();
  });


  it('writes PDF HTML as a pretty report without raw embedded Markdown result data', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-pdf-pretty-markdown-'));
    const result = await writePdfArtifact(
      {
        version: 2,
        success: true,
        outputDir,
        dag: {
          nodes: [{ id: 'step-1', agent: 'writer', status: 'completed', duration: 1 }],
          edges: [],
        },
        steps: [
          {
            id: 'step-1',
            agent: 'writer',
            task: 'Write',
            status: 'completed',
            output: '# Usage Classification Tree\n\n| Rank | Value |\n| --- | --- |\n| Level 1 | Pharmacological Agent |',
          },
        ],
      },
      { outputDir, renderPdf: false },
    );

    const html = await fs.readFile(result.htmlPath, 'utf8');
    expect(html).toContain('<h1>Usage Classification Tree</h1>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('<h2>Result Data</h2>');
    expect(html).not.toContain('&quot;output&quot;: &quot;# Usage Classification Tree');
  });
});
