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

  it('warns but does not fail when grammar output changes length or Markdown structure', () => {
    const priorResults = new Map<string, StepResult>([
      ['step-1', result({ id: 'step-1', agent: 'researcher', output: '# Title\n- I hate this API, but the timeout must remain 30 seconds.\n- Keep API docs.' })],
    ]);
    const validation = validateStepHandoff({
      step: step({ id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', dependsOn: ['step-1'] }),
      result: result({ id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', output: 'This API is acceptable.' }),
      priorResults,
    });

    expect(validation.handoffPassed).toBe(true);
    expect(validation.handoffFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'medium', message: expect.stringContaining('too much') }),
        expect.objectContaining({ severity: 'medium', message: expect.stringContaining('Markdown/list structure') }),
      ]),
    );
  });


  it('still fails grammar output that is empty', () => {
    const validation = validateStepHandoff({
      step: step({ id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', dependsOn: ['step-1'] }),
      result: result({ id: 'step-1-grammar-1', agent: 'grammar-spelling-specialist', outputType: 'answer', output: '' }),
      priorResults: new Map([['step-1', result({ id: 'step-1', output: 'Original text.' })]]),
    });

    expect(validation.handoffPassed).toBe(false);
    expect(validation.handoffFindings[0]).toMatchObject({ severity: 'high' });
  });


  it('fails output-formatter handoff when it drops sections, trees, notes, or key terms', () => {
    const priorResults = new Map<string, StepResult>([
      ['step-1', result({
        id: 'step-1',
        agent: 'usage-classification-tree',
        output: '# Usage Classification Tree\n\nSource method: evidence-backed inference\nConfidence: low\n\n### Tree 1: Metabolomics and Biomarker Identification\n\nPhenolic glycoside\n\n### Tree 2: Analytical Research\n\nMass spectrometry/NMR identification standard\n\n## Notes\n\n- Important caveat preserved.',
      })],
    ]);
    const validation = validateStepHandoff({
      step: step({ id: 'step-2', agent: 'output-formatter', dependsOn: ['step-1'] }),
      result: result({ id: 'step-2', agent: 'output-formatter', output: '| Entity | Usage Domain |\n| X | research |' }),
      priorResults,
    });

    expect(validation.handoffPassed).toBe(false);
    expect(validation.handoffFindings.map((finding) => finding.message).join('\n')).toContain('Formatter dropped');
  });

  it('passes output-formatter handoff when all substantive sections are preserved in a new layout', () => {
    const priorResults = new Map<string, StepResult>([
      ['step-1', result({
        id: 'step-1',
        agent: 'usage-classification-tree',
        output: '# Usage Classification Tree\n\nSource method: evidence-backed inference\nConfidence: low\n\n### Tree 1: Metabolomics\nPhenolic glycoside\n\n## Notes\nImportant caveat preserved.',
      })],
    ]);
    const validation = validateStepHandoff({
      step: step({ id: 'step-2', agent: 'output-formatter', dependsOn: ['step-1'] }),
      result: result({ id: 'step-2', agent: 'output-formatter', output: 'Cell 1: Usage Classification Tree. Source method: evidence-backed inference. Confidence: low. Tree 1: Metabolomics. Phenolic glycoside. Notes: Important caveat preserved.' }),
      priorResults,
    });

    expect(validation.handoffPassed).toBe(true);
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
