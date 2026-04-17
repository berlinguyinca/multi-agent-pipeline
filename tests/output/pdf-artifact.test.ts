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
    expect(html).toContain('Agent Network');
    expect(html).toContain('agent-flow');
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
    expect(html).toContain('artifacts/usage-commonness-ranking.svg');
    expect(await fs.stat(path.join(outputDir, 'artifacts', 'usage-commonness-ranking.svg'))).toBeTruthy();
    expect(await fs.stat(path.join(outputDir, 'artifacts', 'manifest.json'))).toBeTruthy();
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
