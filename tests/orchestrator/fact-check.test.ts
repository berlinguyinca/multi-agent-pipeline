import { describe, expect, it, vi } from 'vitest';
import { maybeScheduleFactCheck } from '../../src/orchestrator/fact-check.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { DAGPlan, StepResult } from '../../src/types/dag.js';

function agent(name: string): AgentDefinition {
  return {
    name,
    description: name,
    adapter: 'ollama',
    model: 'test',
    prompt: 'prompt',
    pipeline: [{ name: 'run' }],
    handles: name,
    output: { type: 'answer' },
    tools: [],
  };
}

describe('maybeScheduleFactCheck', () => {
  it('skips redundant fact-checks after a clean deterministic evidence gate pass', () => {
    const plan: DAGPlan = { plan: [{ id: 'step-1', agent: 'usage-classification-tree', task: 'Usage', dependsOn: [] }] };
    const results = new Map<string, StepResult>();
    const result: StepResult = {
      id: 'step-1',
      agent: 'usage-classification-tree',
      task: 'Usage',
      status: 'completed',
      outputType: 'answer',
      output: '# Usage\n\n## Claim Evidence Ledger\n```json\n{"claims":[]}\n```',
      evidenceGate: { checked: true, passed: true, claims: [], findings: [] },
    };

    maybeScheduleFactCheck({
      step: plan.plan[0]!,
      result,
      plan,
      allIds: new Set(['step-1']),
      agents: new Map([['usage-classification-fact-checker', agent('usage-classification-fact-checker')]]),
      results,
      settled: new Set(['step-1']),
    });

    expect(plan.plan).toHaveLength(1);
    expect(results.has('step-1-fact-check-1')).toBe(false);
  });
  it('reports when it adds a fact-checker helper', () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] },
      ],
    };
    const agents = new Map([
      ['usage-classification-tree', agent('usage-classification-tree')],
      ['usage-classification-fact-checker', agent('usage-classification-fact-checker')],
    ]);
    const reporter = { agentDecision: vi.fn() };

    maybeScheduleFactCheck({
      step: plan.plan[0]!,
      result: {
        id: 'step-1',
        agent: 'usage-classification-tree',
        task: 'Classify usage',
        status: 'completed',
        outputType: 'answer',
        output: 'usage report',
        evidenceGate: { checked: true, passed: true, claims: [], findings: [{ severity: 'medium', message: 'Needs review' }] },
      },
      plan,
      allIds: new Set(['step-1']),
      agents,
      results: new Map(),
      settled: new Set(['step-1']),
      reporter: reporter as never,
    });

    expect(reporter.agentDecision).toHaveBeenCalledWith(expect.objectContaining({
      by: 'step-1 [usage-classification-tree]',
      agent: 'usage-classification-fact-checker',
      decision: 'added',
      stepId: 'step-1-fact-check-1',
    }));
  });

  it('reports why it does not add a fact-checker helper', () => {
    const plan: DAGPlan = {
      plan: [
        { id: 'step-1', agent: 'usage-classification-tree', task: 'Classify usage', dependsOn: [] },
      ],
    };
    const agents = new Map([
      ['usage-classification-tree', agent('usage-classification-tree')],
      ['usage-classification-fact-checker', agent('usage-classification-fact-checker')],
    ]);
    const reporter = { agentDecision: vi.fn() };

    maybeScheduleFactCheck({
      step: plan.plan[0]!,
      result: {
        id: 'step-1',
        agent: 'usage-classification-tree',
        task: 'Classify usage',
        status: 'completed',
        outputType: 'answer',
        output: 'usage report',
        evidenceGate: { checked: true, passed: true, claims: [], findings: [] },
      },
      plan,
      allIds: new Set(['step-1']),
      agents,
      results: new Map(),
      settled: new Set(['step-1']),
      reporter: reporter as never,
    });

    expect(plan.plan).toHaveLength(1);
    expect(reporter.agentDecision).toHaveBeenCalledWith(expect.objectContaining({
      by: 'step-1 [usage-classification-tree]',
      agent: 'usage-classification-fact-checker,evidence-source-reviewer,commonness-evidence-reviewer',
      decision: 'not-needed',
      reason: expect.stringContaining('evidence gate passed cleanly'),
    }));
  });


});
