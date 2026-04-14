import { describe, it, expect, vi } from 'vitest';
import { routeTask } from '../../src/router/router.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AgentAdapter } from '../../src/types/adapter.js';

function mockAdapter(response: string): AgentAdapter {
  return {
    type: 'ollama',
    model: 'gemma4',
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run() {
      yield response;
    },
  };
}

const agents = new Map<string, AgentDefinition>([
  ['researcher', {
    name: 'researcher',
    description: 'Research agent',
    adapter: 'ollama',
    model: 'gemma4',
    prompt: 'You research.',
    pipeline: [{ name: 'research' }],
    handles: 'research questions',
    output: { type: 'answer' },
    tools: [],
  }],
  ['coder', {
    name: 'coder',
    description: 'Coding agent',
    adapter: 'claude',
    prompt: 'You code.',
    pipeline: [{ name: 'execute' }],
    handles: 'code implementation',
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

describe('routeTask', () => {
  it('parses a single-agent plan', async () => {
    const json = '{"plan":[{"id":"step-1","agent":"researcher","task":"Research topic","dependsOn":[]}]}';
    const adapter = mockAdapter(json);

    const plan = await routeTask('What is PostgreSQL?', agents, adapter, routerConfig);

    expect(plan.plan).toHaveLength(1);
    expect(plan.plan[0].agent).toBe('researcher');
  });

  it('parses a multi-agent plan', async () => {
    const json = '{"plan":[{"id":"step-1","agent":"researcher","task":"Research","dependsOn":[]},{"id":"step-2","agent":"coder","task":"Implement","dependsOn":["step-1"]}]}';
    const adapter = mockAdapter(json);

    const plan = await routeTask('Research and build', agents, adapter, routerConfig);

    expect(plan.plan).toHaveLength(2);
    expect(plan.plan[1].dependsOn).toEqual(['step-1']);
  });

  it('throws on invalid JSON', async () => {
    const adapter = mockAdapter('not json');

    await expect(
      routeTask('test', agents, adapter, routerConfig),
    ).rejects.toThrow();
  });

  it('throws on invalid DAG (unknown agent)', async () => {
    const json = '{"plan":[{"id":"step-1","agent":"unknown-agent","task":"test","dependsOn":[]}]}';
    const adapter = mockAdapter(json);

    await expect(
      routeTask('test', agents, adapter, routerConfig),
    ).rejects.toThrow('unknown agent');
  });

  it('strips markdown fences from response', async () => {
    const json = '```json\n{"plan":[{"id":"step-1","agent":"researcher","task":"test","dependsOn":[]}]}\n```';
    const adapter = mockAdapter(json);

    const plan = await routeTask('test', agents, adapter, routerConfig);
    expect(plan.plan).toHaveLength(1);
  });
});
