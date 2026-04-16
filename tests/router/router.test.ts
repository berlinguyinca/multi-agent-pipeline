import { describe, it, expect, vi } from 'vitest';
import { routeTask } from '../../src/router/router.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AgentAdapter } from '../../src/types/adapter.js';

function mockAdapter(response: string, model = 'gemma4') {
  const state: {
    prompt?: string;
    options?: Record<string, unknown>;
  } = {};

  return {
    type: 'ollama',
    model,
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
  ['adviser', {
    name: 'adviser',
    description: 'Workflow adviser',
    adapter: 'ollama',
    model: 'gemma4',
    prompt: 'You advise.',
    pipeline: [{ name: 'advise' }],
    handles: 'workflow advice',
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
  maxStepRetries: 4,
  retryDelayMs: 3_000,
  consensus: {
    enabled: false,
    models: [],
    scope: 'router' as const,
    mode: 'majority' as const,
  },
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


  it('normalizes common router agent aliases to registered agent names', async () => {
    const json = '{"kind":"plan","plan":[{"id":"step-1","agent":"agent-adviser","task":"Advise workflow","dependsOn":[]}]}';
    const adapter = mockAdapter(json);

    const result = await routeTask('Use the adviser', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') throw new Error('Expected router to return a plan');
    expect(result.plan.plan[0].agent).toBe('adviser');
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

  it('reports router timeouts instead of raw abort errors', async () => {
    const adapter = {
      ...mockAdapter(''),
      async *run(_prompt: string, options?: { signal?: AbortSignal }) {
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        const err = new Error('This operation was aborted.');
        (err as Error & { name: string }).name = 'AbortError';
        throw err;
      },
    } satisfies AgentAdapter;

    await expect(
      routeTask('test', agents, adapter, { ...routerConfig, timeoutMs: 1, maxStepRetries: 0, retryDelayMs: 0 }),
    ).rejects.toThrow('Router timed out after 1ms');
  });

  it('retries router timeouts with doubled timeout budgets', async () => {
    const timeoutWindows: number[] = [];
    let callCount = 0;
    const adapter = {
      ...mockAdapter(''),
      async *run(_prompt: string, options?: { signal?: AbortSignal }) {
        callCount += 1;
        const startedAt = Date.now();
        if (callCount <= 2) {
          await new Promise<void>((resolve) => {
            options?.signal?.addEventListener('abort', () => {
              timeoutWindows.push(Date.now() - startedAt);
              resolve();
            }, { once: true });
          });
          const err = new Error('This operation was aborted.');
          (err as Error & { name: string }).name = 'AbortError';
          throw err;
        }
        yield '{"plan":[{"id":"step-1","agent":"researcher","task":"Research topic","dependsOn":[]}]}';
      },
    } satisfies AgentAdapter;

    const result = await routeTask('test', agents, adapter, {
      ...routerConfig,
      timeoutMs: 25,
      maxStepRetries: 2,
      retryDelayMs: 0,
    });

    expect(result.kind).toBe('plan');
    expect(callCount).toBe(3);
    expect(timeoutWindows).toHaveLength(2);
    expect(timeoutWindows[0]).toBeGreaterThanOrEqual(20);
    expect(timeoutWindows[0]).toBeLessThan(90);
    expect(timeoutWindows[1]).toBeGreaterThanOrEqual(45);
    expect(timeoutWindows[1]).toBeLessThan(140);
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

  it('cleans repeated router task token runs before returning the plan', async () => {
    const response = JSON.stringify({
      kind: 'plan',
      plan: [{
        id: 'step-1',
        agent: 'researcher',
        task: 'Synthesize capabilities and create introduction/introduction/introduction/introduction/introduction/step-1',
        dependsOn: [],
      }],
    });
    const adapter = mockAdapter(response);

    const result = await routeTask('Introduce the agent', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }
    expect(result.plan.plan[0].task).toBe('Synthesize capabilities and create introduction step-1');
  });

  it('cleans repeated router task words before returning the plan', async () => {
    const response = JSON.stringify({
      kind: 'plan',
      plan: [{
        id: 'step-1',
        agent: 'researcher',
        task: 'Research capabilities capabilities capabilities capabilities and mission',
        dependsOn: [],
      }],
    });
    const adapter = mockAdapter(response);

    const result = await routeTask('Explain capabilities', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }
    expect(result.plan.plan[0].task).toBe('Research capabilities and mission');
  });

  it('rejects fully degenerate repeated router task text', async () => {
    const response = JSON.stringify({
      kind: 'plan',
      plan: [{
        id: 'step-1',
        agent: 'researcher',
        task: 'introduction/introduction/introduction/introduction/introduction',
        dependsOn: [],
      }],
    });
    const adapter = mockAdapter(response);

    await expect(routeTask('Introduce the agent', agents, adapter, routerConfig))
      .rejects.toThrow('degenerate repeated task text');
  });

  it('uses majority router consensus when two models agree', async () => {
    const agreed = JSON.stringify({
      kind: 'plan',
      plan: [{
        id: 'step-1',
        agent: 'researcher',
        task: 'Research and summarize agent capabilities',
        dependsOn: [],
      }],
    });
    const degenerate = JSON.stringify({
      kind: 'plan',
      plan: [{
        id: 'step-1',
        agent: 'researcher',
        task: 'introduction/introduction/introduction/introduction/introduction',
        dependsOn: [],
      }],
    });

    const result = await routeTask('Introduce the agent', agents, [
      mockAdapter(agreed, 'gemma4'),
      mockAdapter(agreed, 'qwen3'),
      mockAdapter(degenerate, 'llama3'),
    ], {
      ...routerConfig,
      consensus: {
        enabled: true,
        models: ['gemma4', 'qwen3', 'llama3'],
        scope: 'router',
        mode: 'majority',
      },
    });

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }
    expect(result.plan.plan).toEqual([{
      id: 'step-1',
      agent: 'researcher',
      task: 'Research and summarize agent capabilities',
      dependsOn: [],
    }]);
  });

  it('falls back to the best scored valid router plan when there is no majority', async () => {
    const result = await routeTask('Research and build', agents, [
      mockAdapter('{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Research topic","dependsOn":[]}]}', 'gemma4'),
      mockAdapter('{"kind":"plan","plan":[{"id":"step-1","agent":"coder","task":"Implement topic","dependsOn":[]}]}', 'qwen3'),
      mockAdapter('{"kind":"plan","plan":[{"id":"step-1","agent":"unknown","task":"Do topic","dependsOn":[]}]}', 'llama3'),
    ], {
      ...routerConfig,
      consensus: {
        enabled: true,
        models: ['gemma4', 'qwen3', 'llama3'],
        scope: 'router',
        mode: 'majority',
      },
    });

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') {
      throw new Error('Expected router to return a plan');
    }
    expect(result.plan.plan[0].agent).toBe('researcher');
  });

  it('reports all router consensus candidate failures when none are valid', async () => {
    await expect(routeTask('Introduce the agent', agents, [
      mockAdapter('not json', 'gemma4'),
      mockAdapter('{"kind":"plan","plan":[{"id":"step-1","agent":"unknown","task":"Research","dependsOn":[]}]}', 'qwen3'),
      mockAdapter('{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"intro/intro/intro/intro/intro","dependsOn":[]}]}', 'llama3'),
    ], {
      ...routerConfig,
      consensus: {
        enabled: true,
        models: ['gemma4', 'qwen3', 'llama3'],
        scope: 'router',
        mode: 'majority',
      },
    })).rejects.toThrow('Router consensus failed');
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
