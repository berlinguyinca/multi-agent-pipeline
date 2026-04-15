import { describe, it, expect, vi } from 'vitest';
import { routeTask } from '../../src/router/router.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AgentAdapter } from '../../src/types/adapter.js';

function mockAdapter(response: string) {
  const state: {
    prompt?: string;
    options?: Record<string, unknown>;
  } = {};

  return {
    type: 'ollama',
    model: 'gemma4',
    detect: vi.fn(),
    cancel: vi.fn(),
    state,
    async *run(prompt: string, options?: { [key: string]: unknown }) {
      state.prompt = prompt;
      state.options = options;
      yield response;
    },
  } satisfies AgentAdapter & {
    state: { prompt?: string; options?: Record<string, unknown> };
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

    const result = await routeTask('What is PostgreSQL?', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }

    expect(result.plan.plan).toHaveLength(1);
    expect(result.plan.plan[0].agent).toBe('researcher');
  });

  it('parses a multi-agent plan', async () => {
    const json = '{"plan":[{"id":"step-1","agent":"researcher","task":"Research","dependsOn":[]},{"id":"step-2","agent":"coder","task":"Implement","dependsOn":["step-1"]}]}';
    const adapter = mockAdapter(json);

    const result = await routeTask('Research and build', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }

    expect(result.plan.plan).toHaveLength(2);
    expect(result.plan.plan[1].dependsOn).toEqual(['step-1']);
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

    const result = await routeTask('test', agents, adapter, routerConfig);
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }
    expect(result.plan.plan).toHaveLength(1);
  });

  it('extracts JSON after leading reasoning text', async () => {
    const response = 'Thinking...\n{"plan":[{"id":"step-1","agent":"researcher","task":"test","dependsOn":[]}]}';
    const adapter = mockAdapter(response);

    const result = await routeTask('test', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }

    expect(result.plan.plan).toHaveLength(1);
    expect(result.plan.plan[0].agent).toBe('researcher');
  });

  it('extracts JSON after terminal control sequences', async () => {
    const response =
      'Thinking...\u001b[9D\u001b[K{"plan":[{"id":"step-1","agent":"researcher","task":"test","dependsOn":[]}]}';
    const adapter = mockAdapter(response);

    const result = await routeTask('test', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }

    expect(result.plan.plan).toHaveLength(1);
    expect(result.plan.plan[0].agent).toBe('researcher');
  });

  it('reconstructs JSON rewritten with cursor-left and clear-line sequences', async () => {
    const response =
      '{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Research\u001b[2D\u001b[K and synthesize","dependsOn":[]}]}';
    const adapter = mockAdapter(response);

    const result = await routeTask('test', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }

    expect(result.plan.plan[0].task).toContain('synthesize');
  });

  it('prefers the last complete decision when a partial JSON object is followed by a full one', async () => {
    const response =
      '{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Research and synthesize"}]}{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Research and synthesize","dependsOn":[]}]}';
    const adapter = mockAdapter(response);

    const result = await routeTask('test', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }

    expect(result.plan.plan).toHaveLength(1);
    expect(result.plan.plan[0].dependsOn).toEqual([]);
  });

  it('recovers from a truncated first object followed by a valid replacement object', async () => {
    const response =
      '{"kind":"plan","plan":[{"id":"imply-1","agent":"researcher","task":"Researc{"kind":"plan","plan":[{"id":"imply-1","agent":"researcher","task":"Research and synthesize a comprehensive overview","dependsOn":[]}]}';
    const adapter = mockAdapter(response);

    const result = await routeTask('test', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }

    expect(result.plan.plan).toHaveLength(1);
    expect(result.plan.plan[0].task).toContain('Research and synthesize');
  });

  it('skips unrelated JSON objects before the router decision', async () => {
    const response =
      '{"note":"ignore this"}{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"test","dependsOn":[]}]}';
    const adapter = mockAdapter(response);

    const result = await routeTask('test', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }

    expect(result.plan.plan).toHaveLength(1);
    expect(result.plan.plan[0].agent).toBe('researcher');
  });

  it('returns an explicit no-match result when no suitable agent exists', async () => {
    const json = JSON.stringify({
      kind: 'no-match',
      reason: 'No agent can design database migrations safely.',
      suggestedAgent: {
        name: 'migration-planner',
        description: 'Plans safe database migrations and rollback steps',
      },
    });
    const adapter = mockAdapter(json);

    const result = await routeTask('Design a zero-downtime migration strategy', agents, adapter, routerConfig);

    expect(result).toEqual({
      kind: 'no-match',
      reason: 'No agent can design database migrations safely.',
      suggestedAgent: {
        name: 'migration-planner',
        description: 'Plans safe database migrations and rollback steps',
      },
    });
  });

  it('streams raw chunks to the optional callback', async () => {
    const adapter = mockAdapter('{"plan":[{"id":"step-1","agent":"researcher","task":"test","dependsOn":[]}]}');
    const onChunk = vi.fn();

    await routeTask('test', agents, adapter, routerConfig, undefined, onChunk);

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('{"plan":[{"id":"step-1","agent":"researcher","task":"test","dependsOn":[]}]}');
  });

  it('sanitizes noisy terminal frames before sending the prompt to ollama', async () => {
    const adapter = mockAdapter('{"plan":[{"id":"step-1","agent":"researcher","task":"test","dependsOn":[]}]}');
    const noisyTask =
      '╭────────────────────────────────╮\n│ 🍌 Bello! Create Issue │\n╰────────────────────────────────╯';

    await routeTask(noisyTask, agents, adapter, routerConfig);

    expect(adapter.state.prompt).toContain('Bello! Create Issue');
    expect(adapter.state.prompt).not.toContain('╭');
    expect(adapter.state.prompt).not.toContain('╰');
    expect(adapter.state.prompt).not.toContain('│');
    expect(adapter.state.options).toMatchObject({
      responseFormat: 'json',
      hideThinking: true,
      think: false,
    });
  });
});
