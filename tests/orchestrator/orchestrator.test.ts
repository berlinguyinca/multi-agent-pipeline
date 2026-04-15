// tests/orchestrator/orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { executeDAG } from '../../src/orchestrator/orchestrator.js';
import type { DAGPlan } from '../../src/types/dag.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AgentAdapter } from '../../src/types/adapter.js';
import type { SecurityConfig } from '../../src/security/types.js';

function mockAdapter(output: string): AgentAdapter {
  return {
    type: 'claude',
    model: undefined,
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run() {
      yield output;
    },
  };
}

function makeAgent(name: string, outputType: 'answer' | 'data' | 'files' = 'answer'): AgentDefinition {
  return {
    name,
    description: `${name} agent`,
    adapter: 'claude',
    prompt: `You are ${name}.`,
    pipeline: [{ name: 'run' }],
    handles: name,
    output: { type: outputType },
    tools: [],
  };
}

const securityConfig: SecurityConfig = {
  enabled: true,
  maxRemediationRetries: 2,
  adapter: 'ollama',
  model: 'gemma4:26b',
  staticPatternsEnabled: true,
  llmReviewEnabled: false,
};

describe('executeDAG', () => {
  it('executes a single-step DAG', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Research result'));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].output).toBe('Research result');
    expect(result.steps[0].outputType).toBe('answer');
  });

  it('streams raw step chunks to the optional callback', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Raw output'));
    const onOutputChunk = vi.fn();

    await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, onOutputChunk);

    expect(onOutputChunk).toHaveBeenCalledWith('step-1', 'Raw output');
  });

  it('executes parallel steps concurrently', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research A', dependsOn: [] },
        { id: 'step-2', agent: 'researcher', task: 'Research B', dependsOn: [] },
      ],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Result'));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('passes dependency output as context', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build X', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher')],
      ['coder', makeAgent('coder', 'files')],
    ]);
    let capturedPrompt = '';
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        capturedPrompt = prompt;
        yield 'Output';
      },
    }));

    await executeDAG(plan, agents, createAdapter);

    // The second step should receive context from the first
    expect(capturedPrompt).toContain('Build X');
    expect(capturedPrompt).toContain('step-1');
  });

  it('skips steps when dependency fails', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build X', dependsOn: ['step-1'] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher')],
      ['coder', makeAgent('coder', 'files')],
    ]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        throw new Error('Adapter failed');
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[1].status).toBe('skipped');
    expect(result.steps[1].reason).toContain('step-1');
  });

  it('injects agent system prompt and tool catalog into step context', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'coder', task: 'Build X', dependsOn: [] }],
    };
    const coderAgent = makeAgent('coder', 'files');
    coderAgent.prompt = 'You are a coding expert.';
    coderAgent.tools = [{ type: 'builtin', name: 'shell' }];
    const agents = new Map([['coder', coderAgent]]);

    let capturedPrompt = '';
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(prompt: string) {
        capturedPrompt = prompt;
        yield 'Output';
      },
    }));

    await executeDAG(plan, agents, createAdapter);

    expect(capturedPrompt).toContain('You are a coding expert');
    expect(capturedPrompt).toContain('shell');
    expect(capturedPrompt).toContain('Build X');
  });

  it('reports partial success', async () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'researcher', task: 'Research', dependsOn: [] },
        { id: 'step-2', agent: 'coder', task: 'Build', dependsOn: [] },
      ],
    };
    const agents = new Map([
      ['researcher', makeAgent('researcher')],
      ['coder', makeAgent('coder', 'files')],
    ]);
    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        callCount += 1;
        if (callCount === 1) yield 'Success';
        else throw new Error('Failed');
      },
    }));

    const result = await executeDAG(plan, agents, createAdapter);

    expect(result.success).toBe(false);
    const completed = result.steps.filter((s) => s.status === 'completed');
    const failed = result.steps.filter((s) => s.status === 'failed');
    expect(completed).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });

  it('fails gated file output when the security gate finds issues', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'coder', task: 'Build X', dependsOn: [] }],
    };
    const agents = new Map([['coder', makeAgent('coder', 'files')]]);
    const createAdapter = vi.fn(() => mockAdapter('eval(userInput);'));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      { config: securityConfig },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].securityPassed).toBe(false);
    expect(result.steps[0].securityFindings?.[0]?.rule).toBe('eval-injection');
    expect(result.steps[0].error).toContain('Security gate');
  });

  it('retries a failed step up to maxStepRetries', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        callCount += 1;
        if (callCount < 3) throw new Error('Temporary failure');
        yield 'Success on third try';
      },
    }));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 2, retryDelayMs: 0 },
    );

    expect(result.success).toBe(true);
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].output).toBe('Success on third try');
    expect(result.steps[0].attempts).toBe(3);
  });

  it('fails after exhausting retries', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        throw new Error('Persistent failure');
      },
    }));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 1, retryDelayMs: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error).toBe('Persistent failure');
    expect(result.steps[0].attempts).toBe(2);
  });

  it('does not retry non-retryable errors', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'coder', task: 'Build X', dependsOn: [] }],
    };
    const agents = new Map([['coder', makeAgent('coder', 'files')]]);
    let callCount = 0;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run() {
        callCount += 1;
        throw new Error('Execution cancelled');
      },
    }));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 3, retryDelayMs: 0 },
    );

    expect(result.success).toBe(false);
    expect(callCount).toBe(1);
    expect(result.steps[0].attempts).toBe(1);
  });

  it('applies per-step timeout via stepTimeoutMs', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: { signal?: AbortSignal }) {
        // Hang until aborted
        await new Promise<void>((resolve) => {
          opts?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new Error('Step timed out');
      },
    }));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { stepTimeoutMs: 50, maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
  });

  it('reports attempts as 1 when no retries configured', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    const createAdapter = vi.fn(() => mockAdapter('Result'));

    const result = await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(result.steps[0].attempts).toBe(1);
  });

  it('passes adapter-default think=false to ollama adapters', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agent = makeAgent('researcher');
    agent.adapter = 'ollama';
    agent.model = 'gemma4';
    const agents = new Map([['researcher', agent]]);
    let capturedOptions: Record<string, unknown> | undefined;
    const createAdapter = vi.fn(() => ({
      type: 'ollama' as const,
      model: 'gemma4',
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: Record<string, unknown>) {
        capturedOptions = opts;
        yield 'Result';
      },
    }));

    await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 0, retryDelayMs: 0, adapterDefaults: { ollama: { think: false } } },
    );

    expect(capturedOptions?.think).toBe(false);
    expect(capturedOptions?.hideThinking).toBe(true);
  });

  it('agent-level think overrides adapter default', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agent = makeAgent('researcher');
    agent.adapter = 'ollama';
    agent.think = true; // Override the adapter default
    const agents = new Map([['researcher', agent]]);
    let capturedOptions: Record<string, unknown> | undefined;
    const createAdapter = vi.fn(() => ({
      type: 'ollama' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: Record<string, unknown>) {
        capturedOptions = opts;
        yield 'Result';
      },
    }));

    await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 0, retryDelayMs: 0, adapterDefaults: { ollama: { think: false } } },
    );

    expect(capturedOptions?.think).toBe(true);
    expect(capturedOptions?.hideThinking).toBe(false);
  });

  it('does not pass think options when no defaults and no agent override', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Research X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher')]]);
    let capturedOptions: Record<string, unknown> | undefined;
    const createAdapter = vi.fn(() => ({
      type: 'claude' as const,
      model: undefined,
      detect: vi.fn(),
      cancel: vi.fn(),
      async *run(_prompt: string, opts?: Record<string, unknown>) {
        capturedOptions = opts;
        yield 'Result';
      },
    }));

    await executeDAG(
      plan, agents, createAdapter, undefined, undefined, undefined, undefined,
      { maxStepRetries: 0, retryDelayMs: 0 },
    );

    expect(capturedOptions?.think).toBeUndefined();
    expect(capturedOptions?.hideThinking).toBeUndefined();
  });

  it('gates answer-only steps too', async () => {
    const plan: DAGPlan = {
      plan: [{ id: 'step-1', agent: 'researcher', task: 'Explain X', dependsOn: [] }],
    };
    const agents = new Map([['researcher', makeAgent('researcher', 'answer')]]);
    const createAdapter = vi.fn(() => mockAdapter('eval(userInput);'));

    const result = await executeDAG(
      plan,
      agents,
      createAdapter,
      undefined,
      { config: securityConfig },
    );

    expect(result.success).toBe(false);
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].securityPassed).toBe(false);
    expect(result.steps[0].securityFindings?.[0]?.rule).toBe('eval-injection');
  });
});
