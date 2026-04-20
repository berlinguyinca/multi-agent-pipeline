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
      resolvedPrompt: 'Build a local PubChem software tool that syncs files and converts records to Markdown',
      basePrompt: 'Build a local PubChem software tool that syncs files and converts records to Markdown',
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
      'adviser',
      'tdd-engineer',
      'implementation-coder',
      'code-qa-analyst',
      'legal-license-advisor',
      'docs-maintainer',
      'release-readiness-reviewer',
    ]);
    expect(result.decision.plan.plan[0]).toMatchObject({ id: 'step-1', agent: 'spec-writer', dependsOn: [] });
    expect(result.decision.plan.plan[1]).toMatchObject({ id: 'step-2', agent: 'spec-qa-reviewer', dependsOn: ['step-1'] });
    expect(result.decision.plan.plan[3]?.task).toContain('Docker');
    expect(result.decision.plan.plan[3]?.task).toContain('test command');
    expect(result.decision.plan.plan[3]?.task).toContain('1000 PubChem records');
    expect(result.decision.plan.plan[4]?.task).toContain('Do not return a protocol acknowledgment');
    expect(result.decision.plan.plan[4]?.task).toContain('converts them to Markdown');
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
