import { describe, expect, it } from 'vitest';
import { validateStepHandoff } from '../../src/orchestrator/handoff-validation.js';
import type { StepResult, DAGStep } from '../../src/types/dag.js';

function step(overrides: Partial<DAGStep> = {}): DAGStep {
  return { id: 'step-1', agent: 'researcher', task: 'Research', dependsOn: [], ...overrides };
}

function result(overrides: Partial<StepResult> = {}): StepResult {
  return { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', output: 'Useful output', ...overrides };
}

describe('validateStepHandoff', () => {
  it('fails empty completed outputs before downstream handoff', () => {
    const validation = validateStepHandoff({ step: step(), result: result({ outputType: 'answer', output: '   ' }), priorResults: new Map() });

    expect(validation.handoffPassed).toBe(false);
    expect(validation.handoffFindings[0]).toMatchObject({ severity: 'high' });
  });

  it('fails adviser workflow output when JSON is malformed', () => {
    const validation = validateStepHandoff({
      step: step({ agent: 'adviser' }),
      result: result({ agent: 'adviser', output: '{"kind":"adviser-workflow","plan":"not-array"}' }),
      priorResults: new Map(),
    });

    expect(validation.handoffPassed).toBe(false);
    expect(validation.handoffFindings[0]?.message).toContain('Invalid adviser workflow');
  });

  it('flags grammar output that changes tone or drops substantive content', () => {
    const priorResults = new Map<string, StepResult>([
      ['step-1', result({ id: 'step-1', agent: 'researcher', output: 'I hate this API, but the timeout must remain 30 seconds.' })],
    ]);
    const validation = validateStepHandoff({
      step: step({ id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', dependsOn: ['step-1'] }),
      result: result({ id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', output: 'This API is acceptable.' }),
      priorResults,
    });

    expect(validation.handoffPassed).toBe(false);
    expect(validation.handoffFindings.map((finding) => finding.message).join('\n')).toContain('too much');
  });

  it('records spec conformance findings for missing acceptance criteria', () => {
    const validation = validateStepHandoff({
      step: step({ agent: 'implementation-coder', task: 'Implement' }),
      result: result({ agent: 'implementation-coder', output: 'Implemented login flow.' }),
      priorResults: new Map(),
      reviewedSpecContent: '# Spec\n\n- [ ] User can export CSV reports\n- [ ] Admin can disable accounts',
    });

    expect(validation.specConformance.checked).toBe(true);
    expect(validation.specConformance.passed).toBe(false);
    expect(validation.specConformance.missingCriteria).toHaveLength(2);
    expect(validation.handoffPassed).toBe(true);
  });
});
