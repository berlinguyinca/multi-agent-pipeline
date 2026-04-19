import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runHeadlessV2 } from '../../src/headless/runner.js';
import { writeGraphPngArtifacts, writePdfArtifact } from '../../src/output/pdf-artifact.js';
import type { AgentAdapter, AdapterConfig } from '../../src/types/adapter.js';

const RUN_LIVE = process.env['MAP_RUN_LIVE_COCAINE_REPORT_TEST'] === '1';
const PROMPT = 'please provide a classification and taxonomy report for cocaine as well as usages for it on the medical and metabolomics field. Keep this short and assume this will presented to a customer inside a handful of XLS cells. Ensure that correctness is judged fairly and only report the output tables and the graph plot. Nothing else';

describe.skipIf(!RUN_LIVE)('live cocaine classification report command', () => {
  it('generates PDF and graph artifacts through the standard command path', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-cocaine-e2e-'));
    const result = await runHeadlessV2({
      prompt: PROMPT,
      outputDir,
      routerTimeoutMs: 5 * 60 * 1000,
      verbose: true,
    });

    expect(result.dag.nodes.map((node) => node.agent)).toEqual(expect.arrayContaining([
      'classyfire-taxonomy-classifier',
      'usage-classification-tree',
    ]));
    expect(result.success).toBe(true);
    expect(result.error ?? '').not.toContain('No suitable agent available');

    const graph = await writeGraphPngArtifacts(result, { outputDir });
    expect(graph.artifacts.length).toBeGreaterThanOrEqual(5);

    const pdf = await writePdfArtifact(result, { outputDir, dagLayout: 'auto' });
    expect(pdf.htmlPath).toMatch(/map-result-.*\.html$/);
  }, 300_000);
});

describe('cocaine classification report command regression', () => {
  it('routes the standard prompt to taxonomy and usage agents with mocked adapters', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-cocaine-mock-'));
    const createAdapter = (config: AdapterConfig): AgentAdapter => ({
      type: config.type,
      model: config.model,
      detect: async () => ({ installed: true }),
      cancel: () => {},
      async *run(prompt: string) {
        if (prompt.includes('You are a task router')) {
          yield JSON.stringify({
            kind: 'plan',
            plan: [
              { id: 'step-1', agent: 'classyfire-taxonomy-classifier', task: 'Classify cocaine taxonomy', dependsOn: [] },
              { id: 'step-2', agent: 'usage-classification-tree', task: 'Classify cocaine usage', dependsOn: [] },
            ],
          });
          return;
        }
        if (prompt.includes('Fact-check the usage-classification-tree report')) {
          yield 'Fact-check verdict: supported\n\nLedger supported.';
          return;
        }
        if (prompt.includes('Classify cocaine taxonomy')) {
          yield '# ClassyFire / ChemOnt Taxonomic Classification\n\n| Rank | Classification |\n| --- | --- |\n| Kingdom | Organic compounds |\n\n## Claim Evidence Ledger\n```json\n{"claims":[{"id":"tax-1","claim":"Cocaine is an organic compound.","claimType":"chemical-taxonomy","confidence":"high","evidence":[{"sourceType":"document","summary":"taxonomy evidence","supports":"chemical-taxonomy"}]}]}\n```';
          return;
        }
        if (prompt.includes('Classify cocaine usage')) {
          yield '# Usage Classification Tree\n\n## Usage Commonness Ranking\n\n| Rank | Usage/application/exposure origin | Category | Commonness score | Commonness label | Commonness timeframe | Recency/currentness evidence | Evidence/caveat |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 1 | Controlled medical topical anesthetic context | drug | 30 | less common | current | current restricted use | evidence |\n\n## Claim Evidence Ledger\n```json\n{"claims":[{"id":"use-1","claim":"Cocaine has restricted current medical topical anesthetic usage.","claimType":"commonness-score","confidence":"medium","timeframe":"current","recencyStatus":"current","commonnessScore":30,"evidence":[{"sourceType":"url","retrievedAt":"2026-04-19","summary":"current restricted medical usage","supports":"current restricted medical usage"}]}]}\n```';
          return;
        }
        yield 'mock output';
      },
    });

    const result = await runHeadlessV2({
      prompt: PROMPT,
      outputDir,
      routerTimeoutMs: 5 * 60 * 1000,
    }, {
      createAdapterFn: createAdapter,
      loadConfigFn: async () => ({
        agents: {
          spec: { adapter: 'claude' },
          review: { adapter: 'codex' },
          qa: { adapter: 'codex' },
          execute: { adapter: 'claude' },
          docs: { adapter: 'claude' },
        },
        github: {},
        ollama: { host: 'http://localhost:11434', contextLength: 100000, numParallel: 2, maxLoadedModels: 2 },
        quality: { maxSpecQaIterations: 1, maxCodeQaIterations: 1 },
        evidence: {
          enabled: true,
          mode: 'strict',
          requiredAgents: ['usage-classification-tree', 'classyfire-taxonomy-classifier'],
          currentClaimMaxSourceAgeDays: 730,
          freshnessProfiles: { 'usage-commonness': 730, 'chemical-taxonomy': 3650 },
          requireRetrievedAtForWebClaims: true,
          blockUnsupportedCurrentClaims: true,
          remediationMaxRetries: 0,
        },
        outputDir,
        gitCheckpoints: false,
        generateAgentSummary: false,
        headless: { totalTimeoutMs: 60_000, inactivityTimeoutMs: 10_000, pollIntervalMs: 1000 },
        router: {
          adapter: 'ollama',
          model: 'gemma4',
          maxSteps: 10,
          timeoutMs: 30_000,
          stepTimeoutMs: 30_000,
          maxStepRetries: 0,
          retryDelayMs: 0,
          consensus: { enabled: false, models: [], scope: 'router', mode: 'majority' },
        },
        agentCreation: { adapter: 'ollama', model: 'gemma4' },
        adapterDefaults: {},
        agentConsensus: {
          enabled: false,
          runs: 3,
          outputTypes: ['answer'],
          minSimilarity: 0.35,
          perAgent: {},
          fileOutputs: { enabled: false, runs: 3, isolation: 'git-worktree', keepWorktreesOnFailure: true, verificationCommands: [], selection: 'best-passing-minimal-diff' },
        },
        agentOverrides: {},
        security: { enabled: false, maxRemediationRetries: 0, adapter: 'ollama', model: 'gemma4', staticPatternsEnabled: false, llmReviewEnabled: false },
      }),
      detectAllAdaptersFn: async () => ({
        claude: { installed: true },
        codex: { installed: true },
        ollama: { installed: true, models: [] },
        hermes: { installed: true },
        metadata: { installed: true },
        huggingface: { installed: true },
      }),
    });

    expect(result.success).toBe(true);
    expect(result.dag.nodes.map((node) => node.agent)).toEqual(expect.arrayContaining([
      'classyfire-taxonomy-classifier',
      'usage-classification-tree',
    ]));
  });
});
