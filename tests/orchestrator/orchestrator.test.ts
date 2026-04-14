// tests/orchestrator/orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { executeDAG } from '../../src/orchestrator/orchestrator.js';
import type { DAGPlan } from '../../src/types/dag.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { AgentAdapter } from '../../src/types/adapter.js';

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
});
