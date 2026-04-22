import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { routeWithAutonomousRecovery } from '../../src/headless/router-recovery.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AdapterConfig, AgentAdapter } from '../../src/types/adapter.js';

function makeAgent(name: string, outputType: 'answer' | 'files' = 'answer'): AgentDefinition {
  return {
    name,
    description: `${name} agent`,
    adapter: 'ollama',
    model: 'gemma4',
    prompt: `You are ${name}.`,
    pipeline: [{ name: 'run' }],
    handles: name,
    output: { type: outputType },
    tools: [],
  };
}

function noMatchAdapter(output: string): AgentAdapter {
  return {
    type: 'ollama',
    model: 'gemma4',
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run() {
      yield output;
    },
  };
}

describe('routeWithAutonomousRecovery', () => {
  it('falls back to an executable software lifecycle DAG instead of a single protocol-acknowledgment step', async () => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-router-recovery-agents-'));
    const agents = new Map<string, AgentDefinition>([
      ['researcher', makeAgent('researcher')],
      ['spec-writer', makeAgent('spec-writer')],
      ['spec-qa-reviewer', makeAgent('spec-qa-reviewer')],
      ['adviser', makeAgent('adviser')],
      ['coder', makeAgent('coder', 'files')],
      ['tdd-engineer', makeAgent('tdd-engineer', 'files')],
      ['implementation-coder', makeAgent('implementation-coder', 'files')],
      ['code-qa-analyst', makeAgent('code-qa-analyst')],
      ['legal-license-advisor', makeAgent('legal-license-advisor')],
      ['docs-maintainer', makeAgent('docs-maintainer', 'files')],
      ['release-readiness-reviewer', makeAgent('release-readiness-reviewer')],
      ['software-delivery', makeAgent('software-delivery', 'files')],
    ]);
    const noMatch = JSON.stringify({
      kind: 'no-match',
      reason: 'The software-delivery agent is better suited for the full lifecycle of a new feature.',
    });

    const result = await routeWithAutonomousRecovery({
      resolvedPrompt: 'Build a local software tool that syncs files',
      basePrompt: 'Build a local software tool that syncs files',
      agents,
      agentsDir,
      config: {
        ...DEFAULT_CONFIG,
        router: { ...DEFAULT_CONFIG.router, consensus: { enabled: false, models: [], scope: 'router', mode: 'majority' } },
      },
      routerConfig: { ...DEFAULT_CONFIG.router, consensus: { enabled: false, models: [], scope: 'router', mode: 'majority' } },
      reloadAgents: async () => agents,
      dependencies: {
        createAdapterFn: (_config: AdapterConfig) => noMatchAdapter(noMatch),
        detectAllAdaptersFn: async () => ({
          claude: { installed: false },
          codex: { installed: false },
          ollama: { installed: true, models: [] },
          hermes: { installed: false },
          metadata: { installed: true },
          huggingface: { installed: false },
        }),
      },
      maxRecoveryAttempts: 0,
    });

    expect(result.decision.kind).toBe('plan');
    if (result.decision.kind !== 'plan') throw new Error('expected plan');
    expect(result.decision.plan.plan.map((step) => step.agent)).toEqual([
      'spec-writer',
      'spec-qa-reviewer',
      'spec-writer',
      'implementation-coder',
      'code-qa-analyst',
      'legal-license-advisor',
      'docs-maintainer',
      'release-readiness-reviewer',
    ]);
    expect(result.decision.plan.plan[0]).toMatchObject({ id: 'step-1', agent: 'spec-writer', dependsOn: [] });
    expect(result.decision.plan.plan[0]?.task).toContain('Build a local software tool that syncs files');
    expect(result.decision.plan.plan[1]).toMatchObject({ id: 'step-2', agent: 'spec-qa-reviewer', dependsOn: ['step-1'] });
    expect(result.decision.plan.plan[2]).toMatchObject({ id: 'step-3', agent: 'spec-writer', dependsOn: ['step-2'] });
    expect(result.decision.plan.plan[2]?.task).toContain('resolve all concrete blockers identified by spec QA');
    expect(result.decision.plan.plan[3]?.task).toContain('revised spec');
    expect(result.decision.plan.plan[3]?.task).toContain('spec-to-code lifecycle');
    expect(result.decision.plan.plan[3]?.task).toContain('isolated Docker-backed services');
    expect(result.decision.plan.plan[3]?.task).toContain('Do not return a protocol acknowledgment');
    await fs.rm(agentsDir, { recursive: true, force: true });
  });

  it.each([
    ['PubChem', 'Build software to download PubChem FTP bulk data and convert 1000 records to markdown'],
    ['HMDB', 'Build software to download HMDB metabolite XML data and convert 1000 records to markdown'],
    ['Metabolomics Workbench', 'Build software to download Metabolomics Workbench study data and convert 1000 records to markdown'],
  ])('keeps %s downloader software requests on the generic implementation lane', async (_label, prompt) => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-router-recovery-generic-downloader-'));
    const agents = new Map<string, AgentDefinition>([
      ['spec-writer', makeAgent('spec-writer')],
      ['spec-qa-reviewer', makeAgent('spec-qa-reviewer')],
      ['implementation-coder', makeAgent('implementation-coder', 'files')],
      ['code-qa-analyst', makeAgent('code-qa-analyst')],
      ['legal-license-advisor', makeAgent('legal-license-advisor')],
      ['docs-maintainer', makeAgent('docs-maintainer', 'files')],
      ['release-readiness-reviewer', makeAgent('release-readiness-reviewer')],
    ]);
    const noMatch = JSON.stringify({ kind: 'no-match', reason: 'No specialist route exists for this downloader software request.' });

    const result = await routeWithAutonomousRecovery({
      resolvedPrompt: prompt,
      basePrompt: prompt,
      agents,
      agentsDir,
      config: {
        ...DEFAULT_CONFIG,
        router: { ...DEFAULT_CONFIG.router, consensus: { enabled: false, models: [], scope: 'router', mode: 'majority' } },
      },
      routerConfig: { ...DEFAULT_CONFIG.router, consensus: { enabled: false, models: [], scope: 'router', mode: 'majority' } },
      reloadAgents: async () => agents,
      dependencies: {
        createAdapterFn: () => noMatchAdapter(noMatch),
        detectAllAdaptersFn: async () => ({
          claude: { installed: false },
          codex: { installed: false },
          ollama: { installed: true, models: [] },
          hermes: { installed: false },
          metadata: { installed: true },
          huggingface: { installed: false },
        }),
      },
      maxRecoveryAttempts: 0,
    });

    expect(result.decision.kind).toBe('plan');
    if (result.decision.kind !== 'plan') throw new Error('expected plan');
    const agentsInPlan = result.decision.plan.plan.map((step) => step.agent);
    expect(agentsInPlan).toContain('implementation-coder');
    expect(agentsInPlan).not.toContain('pubchem-sync-builder');
    expect(agentsInPlan).not.toContain('hmdb-sync-builder');
    expect(agentsInPlan).not.toContain('metabolomics-workbench-sync-builder');
    const implementationTask = result.decision.plan.plan.find((step) => step.agent === 'implementation-coder')?.task ?? '';
    expect(implementationTask).toContain('prompt-specific downloader');
    expect(implementationTask).toContain('actual data');
    expect(implementationTask).toContain('not empty');
    await fs.rm(agentsDir, { recursive: true, force: true });
  });

  it('adds goal synthesis and project knowledge memory when those agents are available in software fallback', async () => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-router-recovery-goal-agents-'));
    const agents = new Map<string, AgentDefinition>([
      ['goal-synthesizer', makeAgent('goal-synthesizer')],
      ['spec-writer', makeAgent('spec-writer')],
      ['spec-qa-reviewer', makeAgent('spec-qa-reviewer')],
      ['implementation-coder', makeAgent('implementation-coder', 'files')],
      ['code-qa-analyst', makeAgent('code-qa-analyst')],
      ['legal-license-advisor', makeAgent('legal-license-advisor')],
      ['docs-maintainer', makeAgent('docs-maintainer', 'files')],
      ['release-readiness-reviewer', makeAgent('release-readiness-reviewer')],
      ['project-knowledge-curator', makeAgent('project-knowledge-curator')],
    ]);
    const noMatch = JSON.stringify({ kind: 'no-match', reason: 'No specialist route exists for this software request.' });

    const result = await routeWithAutonomousRecovery({
      resolvedPrompt: 'Build a local software tool that syncs files',
      basePrompt: 'Build a local software tool that syncs files',
      agents,
      agentsDir,
      config: {
        ...DEFAULT_CONFIG,
        router: { ...DEFAULT_CONFIG.router, consensus: { enabled: false, models: [], scope: 'router', mode: 'majority' } },
      },
      routerConfig: { ...DEFAULT_CONFIG.router, consensus: { enabled: false, models: [], scope: 'router', mode: 'majority' } },
      reloadAgents: async () => agents,
      dependencies: {
        createAdapterFn: () => noMatchAdapter(noMatch),
        detectAllAdaptersFn: async () => ({
          claude: { installed: false },
          codex: { installed: false },
          ollama: { installed: true, models: [] },
          hermes: { installed: false },
          metadata: { installed: true },
          huggingface: { installed: false },
        }),
      },
      maxRecoveryAttempts: 0,
    });

    expect(result.decision.kind).toBe('plan');
    if (result.decision.kind !== 'plan') throw new Error('expected plan');
    expect(result.decision.plan.plan.map((step) => step.agent)).toEqual([
      'goal-synthesizer',
      'spec-writer',
      'spec-qa-reviewer',
      'spec-writer',
      'implementation-coder',
      'code-qa-analyst',
      'legal-license-advisor',
      'docs-maintainer',
      'release-readiness-reviewer',
      'project-knowledge-curator',
    ]);
    expect(result.decision.plan.plan[1]).toMatchObject({ agent: 'spec-writer', dependsOn: ['step-1'] });
    expect(result.decision.plan.plan[8]).toMatchObject({ agent: 'release-readiness-reviewer', final: true });
    expect(result.decision.plan.plan[9]).toMatchObject({ agent: 'project-knowledge-curator', dependsOn: ['step-9'] });
    await fs.rm(agentsDir, { recursive: true, force: true });
  });


  it('adds ledger instructions when best-effort fallback must use an evidence-required agent', async () => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-router-recovery-ledger-'));
    const agents = new Map<string, AgentDefinition>([
      ['researcher', makeAgent('researcher')],
    ]);
    const noMatch = JSON.stringify({
      kind: 'no-match',
      reason: 'No specialist route exists for the requested research.',
    });

    const result = await routeWithAutonomousRecovery({
      resolvedPrompt: 'Research the topic',
      basePrompt: 'Research the topic',
      agents,
      agentsDir,
      config: {
        ...DEFAULT_CONFIG,
        evidence: { ...DEFAULT_CONFIG.evidence, requiredAgents: ['researcher'] },
        router: { ...DEFAULT_CONFIG.router, consensus: { enabled: false, models: [], scope: 'router', mode: 'majority' } },
      },
      routerConfig: { ...DEFAULT_CONFIG.router, consensus: { enabled: false, models: [], scope: 'router', mode: 'majority' } },
      reloadAgents: async () => agents,
      dependencies: {
        createAdapterFn: (_config: AdapterConfig) => noMatchAdapter(noMatch),
        detectAllAdaptersFn: async () => ({
          claude: { installed: false },
          codex: { installed: false },
          ollama: { installed: true, models: [] },
          hermes: { installed: false },
          metadata: { installed: true },
          huggingface: { installed: false },
        }),
      },
      maxRecoveryAttempts: 0,
    });

    expect(result.decision.kind).toBe('plan');
    if (result.decision.kind !== 'plan') throw new Error('expected plan');
    expect(result.decision.plan.plan[0]?.agent).toBe('researcher');
    expect(result.decision.plan.plan[0]?.task).toContain('Claim Evidence Ledger');
    await fs.rm(agentsDir, { recursive: true, force: true });
  });
});
