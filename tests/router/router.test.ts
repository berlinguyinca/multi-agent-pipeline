import { describe, it, expect, vi } from 'vitest';
import { routeTask } from '../../src/router/router.js';
import { buildRouterPrompt } from '../../src/router/prompt-builder.js';
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

  it('preserves router rationale for selected and rejected agents', async () => {
    const json = JSON.stringify({
      kind: 'plan',
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research topic', dependsOn: [] }],
      rationale: {
        selectedAgents: [{ agent: 'researcher', reason: 'Needs evidence synthesis' }],
        rejectedAgents: [{ agent: 'coder', reason: 'No code changes requested' }],
      },
    });

    const result = await routeTask('What is PostgreSQL?', agents, mockAdapter(json), routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') throw new Error('Expected router to return a plan');
    expect(result.rationale).toEqual({
      selectedAgents: [{ agent: 'researcher', reason: 'Needs evidence synthesis' }],
      rejectedAgents: [{ agent: 'coder', reason: 'No code changes requested' }],
    });
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

  it('tells the router to use read-only metadata generators for existing-codebase work', () => {
    const prompt = buildRouterPrompt(agents, 'Refactor an existing codebase');

    expect(prompt).toContain('read-only metadata generator step');
    expect(prompt).toContain('codesight-metadata');
    expect(prompt).toContain('must not modify source files');
  });

  it('tells the router to route model installation through model-installer', () => {
    const prompt = buildRouterPrompt(agents, 'Install a Hugging Face chemistry model into Ollama');

    expect(prompt).toContain('model-installer');
    expect(prompt).toContain('download, pull, import, build, install, or verify');
    expect(prompt).toContain('Hugging Face or Ollama model');
  });


  it('normalizes common router agent aliases to registered agent names', async () => {
    const json = '{"kind":"plan","plan":[{"id":"step-1","agent":"agent-adviser","task":"Advise workflow","dependsOn":[]}]}';
    const adapter = mockAdapter(json);

    const result = await routeTask('Use the adviser', agents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') throw new Error('Expected router to return a plan');
    expect(result.plan.plan[0].agent).toBe('adviser');
  });


  it('repairs router plans that reference missing dependency step ids', async () => {
    const json = '{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Research taxonomy","dependsOn":[]},{"id":"step-3","agent":"usage-classification-tree","task":"Build usage tree","dependsOn":["step-2"]}]}';
    const localAgents = new Map(agents);
    localAgents.set('usage-classification-tree', {
      name: 'usage-classification-tree',
      description: 'Usage tree agent',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'You classify usage.',
      pipeline: [{ name: 'classify' }],
      handles: 'usage classification',
      output: { type: 'answer' },
      tools: [],
    });
    const adapter = mockAdapter(json);

    const result = await routeTask('Build taxonomy and usage tree', localAgents, adapter, routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') throw new Error('Expected router to return a plan');
    expect(result.plan.plan.find((step) => step.id === 'step-3')?.dependsOn).toEqual([]);
  });

  it('rewires final formatter steps to depend on prior source steps when the router omits dependencies', async () => {
    const localAgents = new Map(agents);
    localAgents.set('usage-classification-tree', {
      name: 'usage-classification-tree',
      description: 'Usage tree agent',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'You classify usage.',
      pipeline: [{ name: 'classify' }],
      handles: 'usage classification',
      output: { type: 'answer' },
      tools: [],
    });
    localAgents.set('output-formatter', {
      name: 'output-formatter',
      description: 'Formatter',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'You format.',
      pipeline: [{ name: 'format' }],
      handles: 'format reports',
      output: { type: 'answer' },
      tools: [],
    });
    const json = JSON.stringify({
      kind: 'plan',
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research taxonomy', dependsOn: [] },
        { id: 'step-2', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] },
        { id: 'format-step-3', agent: 'output-formatter', task: 'Format final report', dependsOn: [] },
      ],
    });

    const result = await routeTask('Build final report', localAgents, mockAdapter(json), routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') throw new Error('Expected router to return a plan');
    expect(result.plan.plan[2].dependsOn).toEqual(['step-1', 'step-2']);
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
    expect(result.consensus?.participants.map((participant) => ({
      model: participant.model,
      status: participant.status,
      contribution: participant.contribution,
    }))).toEqual([
      { model: 'gemma4', status: 'contributed', contribution: 1 },
      { model: 'qwen3', status: 'contributed', contribution: 1 },
      { model: 'llama3', status: 'failed', contribution: 0 },
    ]);
  });

  it('uses a deterministic specialist route for customer-facing chemical table and graph reports', async () => {
    const localAgents = new Map(agents);
    localAgents.set('classyfire-taxonomy-classifier', {
      name: 'classyfire-taxonomy-classifier',
      description: 'Taxonomy',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'taxonomy',
      pipeline: [{ name: 'classify' }],
      handles: 'chemical taxonomy',
      output: { type: 'answer' },
      tools: [],
    });
    localAgents.set('usage-classification-tree', {
      name: 'usage-classification-tree',
      description: 'Usage',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'usage',
      pipeline: [{ name: 'classify' }],
      handles: 'usage classification',
      output: { type: 'answer' },
      tools: [],
    });
    const adapter = mockAdapter(JSON.stringify({
      kind: 'plan',
      plan: [{ id: 'step-1', agent: 'researcher', task: 'generic report', dependsOn: [] }],
    }));

    const result = await routeTask('classification and taxonomy report for cocaine with medical usages; only report output tables and graph plot for customer XLS cells', localAgents, adapter, routerConfig);

    expect(adapter.state.prompt).toBeUndefined();
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') throw new Error('Expected deterministic plan');
    expect(result.plan.plan.map((step) => step.agent)).toEqual([
      'classyfire-taxonomy-classifier',
      'usage-classification-tree',
    ]);
    expect(result.plan.plan[1]?.task).toContain('Call web-search before the final answer');
  });

  it('prunes generic researcher synthesis from chemical taxonomy and usage specialist reports', async () => {
    const localAgents = new Map(agents);
    localAgents.set('classyfire-taxonomy-classifier', {
      name: 'classyfire-taxonomy-classifier',
      description: 'Taxonomy',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'taxonomy',
      pipeline: [{ name: 'classify' }],
      handles: 'chemical taxonomy',
      output: { type: 'answer' },
      tools: [],
    });
    localAgents.set('usage-classification-tree', {
      name: 'usage-classification-tree',
      description: 'Usage',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'usage',
      pipeline: [{ name: 'classify' }],
      handles: 'usage classification',
      output: { type: 'answer' },
      tools: [],
    });

    const result = await routeTask('classification and taxonomy report for cocaine with medical and metabolomics usage tables', localAgents, mockAdapter(JSON.stringify({
      kind: 'plan',
      plan: [
        { id: 'step-1', agent: 'classyfire-taxonomy-classifier', task: 'Generate cocaine taxonomy', dependsOn: [] },
        { id: 'step-2', agent: 'usage-classification-tree', task: 'Generate cocaine usage tables', dependsOn: [] },
        { id: 'step-3', agent: 'researcher', task: 'Synthesize the taxonomy and usage data into a final customer report', dependsOn: ['step-1', 'step-2'] },
      ],
      rationale: {
        selectedAgents: [
          { agent: 'classyfire-taxonomy-classifier', reason: 'taxonomy specialist' },
          { agent: 'usage-classification-tree', reason: 'usage specialist' },
          { agent: 'researcher', reason: 'generic synthesis' },
        ],
        rejectedAgents: [],
      },
    })), routerConfig);

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') throw new Error('Expected router to return a plan');
    expect(result.plan.plan.map((step) => step.agent)).toEqual([
      'classyfire-taxonomy-classifier',
      'usage-classification-tree',
    ]);
    expect(result.rationale?.selectedAgents.map((entry) => entry.agent)).toEqual([
      'classyfire-taxonomy-classifier',
      'usage-classification-tree',
    ]);
  });

  it('does not abort consensus when every candidate returns rationale-only JSON', async () => {
    const rationaleOnly = JSON.stringify({
      agent: 'researcher',
      reason: 'While capable of research, specialized taxonomy and usage agents provide more structured output.',
    });

    const localAgents = new Map(agents);
    localAgents.set('classyfire-taxonomy-classifier', {
      name: 'classyfire-taxonomy-classifier',
      description: 'Taxonomy',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'taxonomy',
      pipeline: [{ name: 'classify' }],
      handles: 'chemical taxonomy',
      output: { type: 'answer' },
      tools: [],
    });
    localAgents.set('usage-classification-tree', {
      name: 'usage-classification-tree',
      description: 'Usage',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'usage',
      pipeline: [{ name: 'classify' }],
      handles: 'usage classification',
      output: { type: 'answer' },
      tools: [],
    });

    const result = await routeTask('classification and taxonomy report for cocaine with usage tables', localAgents, [
      mockAdapter(rationaleOnly, 'gemma4:26b'),
      mockAdapter(rationaleOnly, 'gemma4:26b'),
      mockAdapter(rationaleOnly, 'gemma4:26b'),
    ], {
      ...routerConfig,
      consensus: {
        enabled: true,
        models: ['gemma4:26b', 'gemma4:26b', 'gemma4:26b'],
        scope: 'router',
        mode: 'majority',
      },
    });

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') throw new Error('Expected fallback plan');
    expect(result.plan.plan.map((step) => step.agent)).toEqual([
      'classyfire-taxonomy-classifier',
      'usage-classification-tree',
    ]);
    expect(result.rationale?.selectedAgents.map((entry) => entry.agent)).toEqual([
      'classyfire-taxonomy-classifier',
      'usage-classification-tree',
    ]);
    expect(result.rationale?.rejectedAgents).toEqual([]);
  });

  it('runs router consensus candidates sequentially to avoid concurrent Ollama requests', async () => {
    const agreed = JSON.stringify({
      kind: 'plan',
      plan: [{
        id: 'step-1',
        agent: 'researcher',
        task: 'Research sequential routing',
        dependsOn: [],
      }],
    });
    let active = 0;
    let maxActive = 0;
    const sequentialAdapter = (model: string) => ({
      type: 'ollama' as const,
      model,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        yield agreed;
      },
    });

    const result = await routeTask('Introduce the agent', agents, [
      sequentialAdapter('gemma4'),
      sequentialAdapter('qwen3'),
      sequentialAdapter('llama3'),
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
    expect(maxActive).toBe(1);
  });

  it('uses the provided Ollama concurrency limit for router consensus candidates', async () => {
    const agreed = JSON.stringify({
      kind: 'plan',
      plan: [{
        id: 'step-1',
        agent: 'researcher',
        task: 'Research parallel routing',
        dependsOn: [],
      }],
    });
    let active = 0;
    let maxActive = 0;
    const concurrentAdapter = (model: string) => ({
      type: 'ollama' as const,
      model,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        yield agreed;
      },
    });

    const result = await routeTask('Introduce the agent', agents, [
      concurrentAdapter('gemma4'),
      concurrentAdapter('qwen3'),
      concurrentAdapter('llama3'),
    ], {
      ...routerConfig,
      ollamaConcurrency: 2,
      consensus: {
        enabled: true,
        models: ['gemma4', 'qwen3', 'llama3'],
        scope: 'router',
        mode: 'majority',
      },
    });

    expect(result.kind).toBe('plan');
    expect(maxActive).toBe(2);
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
