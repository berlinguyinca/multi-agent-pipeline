import { describe, expect, it } from 'vitest';
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
});
