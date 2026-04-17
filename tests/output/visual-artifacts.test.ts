import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createReportVisualArtifacts } from '../../src/output/visual-artifacts.js';

const usageOutput = `# Usage Classification Tree

Entity: Alanine

## Usage Commonness Ranking

| Rank | Usage/application/exposure origin | Category | Commonness score | Commonness label | Evidence/caveat |
| --- | --- | --- | --- | --- | --- |
| 1 | Cellular endogenous amino acid | cellular endogenous compound | 95 | very common | Proteinogenic amino acid across species |
| 2 | Nutritional amino acid exposure | food compound / food metabolite | 72 | common | Found in dietary proteins |
| 3 | Research reagent | research | 35 | less common | Used as analytical standard |
`;

const taxonomyOutput = `# ClassyFire / ChemOnt Taxonomic Classification

## Taxonomy Tree

| Rank | Classification |
| --- | --- |
| Kingdom | Organic compounds |
| Superclass | Amino acids |
| Class | alpha-amino acids |
`;

describe('visual report artifacts', () => {
  it('writes a manifest plus deterministic SVG artifacts for agent graph and classification outputs', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-visual-artifacts-'));
    const result = {
      version: 2,
      success: true,
      outputDir,
      dag: {
        nodes: [
          { id: 'step-1', agent: 'classyfire-taxonomy-classifier', status: 'completed', duration: 12 },
          { id: 'step-2', agent: 'usage-classification-tree', status: 'completed', duration: 34 },
        ],
        edges: [{ from: 'step-1', to: 'step-2', type: 'planned' }],
      },
      steps: [
        { id: 'step-1', agent: 'classyfire-taxonomy-classifier', task: 'Classify', status: 'completed', output: taxonomyOutput },
        { id: 'step-2', agent: 'usage-classification-tree', task: 'Classify usage', status: 'completed', output: usageOutput },
      ],
    };

    const manifest = await createReportVisualArtifacts(result, { outputDir });

    expect(manifest.artifacts.map((artifact) => artifact.id)).toEqual([
      'agent-network',
      'usage-commonness-ranking',
      'taxonomy-tree',
    ]);
    expect(manifest.manifestPath).toBe(path.join(outputDir, 'artifacts', 'manifest.json'));

    const usage = manifest.artifacts.find((artifact) => artifact.id === 'usage-commonness-ranking');
    expect(usage).toMatchObject({ kind: 'plot', mimeType: 'image/svg+xml', deterministic: true });
    expect(usage?.src).toBe('artifacts/usage-commonness-ranking.svg');

    const usageSvg = await fs.readFile(path.join(outputDir, usage!.src), 'utf8');
    expect(usageSvg).toContain('<svg');
    expect(usageSvg).toContain('Cellular endogenous amino acid');
    expect(usageSvg).toContain('95');
    expect(usageSvg).not.toContain('<script');

    const manifestJson = JSON.parse(await fs.readFile(manifest.manifestPath, 'utf8')) as typeof manifest;
    expect(manifestJson.artifacts).toHaveLength(3);
  });
});
