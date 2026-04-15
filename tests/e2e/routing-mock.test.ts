// tests/e2e/routing-mock.test.ts
import { describe, it, expect, vi } from 'vitest';
import { routeTask } from '../../src/router/router.js';
import { executeDAG } from '../../src/orchestrator/orchestrator.js';
import { buildHeadlessResultV2 } from '../../src/headless/result-builder.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AgentAdapter } from '../../src/types/adapter.js';

describe('end-to-end routing flow (mocked adapters)', () => {
  const agents = new Map<string, AgentDefinition>([
    ['researcher', {
      name: 'researcher',
      description: 'Research agent',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'You research.',
      pipeline: [{ name: 'research' }],
      handles: 'research questions, explanations',
      output: { type: 'answer' },
      tools: [],
    }],
    ['coder', {
      name: 'coder',
      description: 'Coding agent',
      adapter: 'claude',
      prompt: 'You code.',
      pipeline: [{ name: 'execute' }],
      handles: 'code implementation, features',
      output: { type: 'files' },
      tools: [],
    }],
  ]);

  const routerConfig = {
    adapter: 'ollama' as const,
    model: 'gemma4',
    maxSteps: 10,
    timeoutMs: 30_000,
  };

  it('routes a research task to single researcher agent and produces v2 result', async () => {
    const routerResponse = '{"plan":[{"id":"step-1","agent":"researcher","task":"Explain PostgreSQL partitioning","dependsOn":[]}]}';
    const routerAdapter: AgentAdapter = {
      type: 'ollama',
      model: 'gemma4',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() { yield routerResponse; },
    };

    const decision = await routeTask('What is PostgreSQL partitioning?', agents, routerAdapter, routerConfig);
    expect(decision.kind).toBe('plan');
    if (decision.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }

    const plan = decision.plan;
    expect(plan.plan).toHaveLength(1);
    expect(plan.plan[0].agent).toBe('researcher');

    const createAdapter = vi.fn(() => ({
      type: 'ollama' as const,
      model: 'gemma4',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() { yield 'PostgreSQL supports range, list, and hash partitioning...'; },
    }));

    const dagResult = await executeDAG(plan, agents, createAdapter);
    expect(dagResult.success).toBe(true);

    const result = buildHeadlessResultV2(plan, dagResult.steps, 5000);
    expect(result.version).toBe(2);
    expect(result.success).toBe(true);
    expect(result.steps[0].outputType).toBe('answer');
    expect(result.dag.nodes).toHaveLength(1);
    expect(result.dag.edges).toHaveLength(0);
  });

  it('routes a compound task to researcher then coder and produces v2 result', async () => {
    const routerResponse = '{"plan":[{"id":"step-1","agent":"researcher","task":"Research best practices","dependsOn":[]},{"id":"step-2","agent":"coder","task":"Implement solution","dependsOn":["step-1"]}]}';
    const routerAdapter: AgentAdapter = {
      type: 'ollama',
      model: 'gemma4',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() { yield routerResponse; },
    };

    const decision = await routeTask('Research and build a caching layer', agents, routerAdapter, routerConfig);
    expect(decision.kind).toBe('plan');
    if (decision.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }

    const plan = decision.plan;
    expect(plan.plan).toHaveLength(2);

    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        callCount += 1;
        if (callCount === 1) yield 'Use Redis for caching.';
        else yield 'Implemented caching layer.';
      },
    }));

    const dagResult = await executeDAG(plan, agents, createAdapter);
    expect(dagResult.success).toBe(true);

    const result = buildHeadlessResultV2(plan, dagResult.steps, 20000);
    expect(result.version).toBe(2);
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].outputType).toBe('answer');
    expect(result.steps[1].outputType).toBe('files');
    expect(result.dag.edges).toEqual([{ from: 'step-1', to: 'step-2', type: 'planned' }]);
  });
});
