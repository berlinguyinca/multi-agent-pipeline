import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createAgentGraphPngArtifacts, createReportVisualArtifacts } from '../../src/output/visual-artifacts.js';

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

  it('writes a compact layered agent-network SVG with consensus run models', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-visual-consensus-'));
    const result = {
      version: 2,
      success: true,
      outputDir,
      dag: {
        nodes: [
          { id: 'step-1', agent: 'researcher', status: 'completed', duration: 12 },
          { id: 'step-2', agent: 'data-loader', status: 'completed', duration: 9 },
          { id: 'step-3', agent: 'writer', status: 'completed', duration: 34 },
        ],
        edges: [
          { from: 'step-1', to: 'step-3', type: 'planned' },
          { from: 'step-2', to: 'step-3', type: 'planned' },
        ],
      },
      steps: [
        {
          id: 'step-1',
          agent: 'researcher',
          task: 'Research',
          status: 'completed',
          output: 'Research',
          consensus: {
            enabled: true,
            runs: 3,
            candidateCount: 3,
            selectedRun: 1,
            agreement: 2 / 3,
            method: 'exact-majority',
            participants: [
              { run: 1, provider: 'ollama', model: 'gemma4:26b', status: 'contributed', contribution: 1 },
              { run: 2, provider: 'ollama', model: 'qwen2.5:14b', status: 'rejected', contribution: 0 },
            ],
          },
        },
        { id: 'step-2', agent: 'data-loader', task: 'Load data', status: 'completed', output: 'Data' },
        { id: 'step-3', agent: 'writer', task: 'Write', status: 'completed', output: 'Final' },
      ],
    };

    const manifest = await createReportVisualArtifacts(result, { outputDir });
    const graph = manifest.artifacts.find((artifact) => artifact.id === 'agent-network');
    const graphSvg = await fs.readFile(path.join(outputDir, graph!.src), 'utf8');

    expect(graphSvg).toContain('Stage 1 concurrent');
    expect(graphSvg).toContain('Stage 2 sequence');
    expect(graphSvg).toContain('Consensus 3x exact-majority');
    expect(graphSvg).toContain('r1 ollama/gemma4:26b contributed 100%');
    expect(graphSvg).toContain('step-1 to step-3');
    expect(graphSvg).not.toContain('<script');
  });



  it('can force metro and cluster SVG agent-network layouts', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-visual-layouts-'));
    const result = {
      version: 2,
      success: true,
      outputDir,
      dag: {
        nodes: [
          { id: 'step-1', agent: 'researcher', status: 'completed', duration: 1 },
          { id: 'step-2', agent: 'writer', status: 'completed', duration: 1 },
        ],
        edges: [{ from: 'step-1', to: 'step-2', type: 'planned' }],
      },
      steps: [
        { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', output: 'Research' },
        { id: 'step-2', agent: 'writer', task: 'Write', status: 'completed', output: 'Final' },
      ],
    };

    const metro = await createReportVisualArtifacts(result, { outputDir, dagLayout: 'metro' });
    const metroGraph = metro.artifacts.find((artifact) => artifact.id === 'agent-network');
    const metroSvg = await fs.readFile(path.join(outputDir, metroGraph!.src), 'utf8');
    expect(metroSvg).toContain('Agent Metro');

    const cluster = await createReportVisualArtifacts(result, { outputDir, dagLayout: 'cluster' });
    const clusterGraph = cluster.artifacts.find((artifact) => artifact.id === 'agent-network');
    const clusterSvg = await fs.readFile(path.join(outputDir, clusterGraph!.src), 'utf8');
    expect(clusterSvg).toContain('Agent Clusters');
  });


  it('writes matrix lane SVG for large agent networks', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-visual-matrix-'));
    const nodes = Array.from({ length: 13 }, (_, index) => ({
      id: `step-${index + 1}`,
      agent: index % 3 === 0 ? 'researcher' : index % 3 === 1 ? 'implementation-coder' : 'verifier',
      status: 'completed',
      duration: 10 + index,
    }));
    const result = {
      version: 2,
      success: true,
      outputDir,
      dag: {
        nodes,
        edges: nodes.slice(1).map((node, index) => ({ from: `step-${index + 1}`, to: node.id, type: 'planned' })),
      },
      steps: nodes.map((node) => ({ ...node, task: `Task ${node.id}`, output: `Output ${node.id}` })),
    };

    const manifest = await createReportVisualArtifacts(result, { outputDir });
    const graph = manifest.artifacts.find((artifact) => artifact.id === 'agent-network');
    const graphSvg = await fs.readFile(path.join(outputDir, graph!.src), 'utf8');

    expect(graphSvg).toContain('Agent Matrix');
    expect(graphSvg).toContain('Role / Stage');
    expect(graphSvg).toContain('implementation-coder');
    expect(graphSvg).toContain('step-13');
  });

  it('writes agent graph image artifacts for every supported layout', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-graph-png-layouts-'));
    const result = {
      version: 2,
      success: true,
      outputDir,
      dag: {
        nodes: [
          { id: 'step-1', agent: 'researcher', status: 'completed', duration: 1 },
          { id: 'step-2', agent: 'writer', status: 'completed', duration: 1 },
        ],
        edges: [{ from: 'step-1', to: 'step-2', type: 'planned' }],
      },
      steps: [
        { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', output: 'Research' },
        { id: 'step-2', agent: 'writer', task: 'Write', status: 'completed', output: 'Final' },
      ],
    };

    const manifest = await createAgentGraphPngArtifacts(result, { outputDir, renderPng: false });

    expect(manifest.artifacts.map((artifact) => artifact.id)).toEqual([
      'agent-network-auto',
      'agent-network-stage',
      'agent-network-metro',
      'agent-network-matrix',
      'agent-network-cluster',
    ]);
    expect(manifest.warnings).toEqual([
      'PNG rendering disabled; wrote SVG graph artifacts instead.',
    ]);
    for (const artifact of manifest.artifacts) {
      expect(artifact.kind).toBe('flowchart');
      expect(artifact.format).toBe('svg');
      const svg = await fs.readFile(artifact.path, 'utf8');
      expect(svg).toContain('<svg');
      expect(svg).toContain('Agent');
    }
  });

});
