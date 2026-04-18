import { describe, expect, it } from 'vitest';
import { runEvidenceGate } from '../../src/orchestrator/evidence-gate.js';
import type { DAGStep, StepResult } from '../../src/types/dag.js';

const step: DAGStep = {
  id: 'step-1',
  agent: 'usage-classification-tree',
  task: 'Classify usage',
  dependsOn: [],
};

function resultWithClaims(claims: unknown[]): StepResult {
  return {
    id: step.id,
    agent: step.agent,
    task: step.task,
    status: 'completed',
    output: [
      '# Usage Classification Tree',
      '',
      '## Claim Evidence Ledger',
      '',
      '```json',
      JSON.stringify({ claims }),
      '```',
    ].join('\n'),
  };
}

describe('evidence gate', () => {
  it('allows ordinary current usage claims with direct non-stale evidence even without prevalence wording', () => {
    const gate = runEvidenceGate({
      step,
      result: resultWithClaims([
        {
          id: 'claim-1',
          claim: 'Alanine is an endogenous cellular compound in humans.',
          claimType: 'usage-classification',
          confidence: 'high',
          timeframe: 'current',
          recencyStatus: 'current',
          evidence: [
            {
              sourceType: 'url',
              title: 'Biochemistry reference',
              retrievedAt: '2026-04-18',
              summary: 'Alanine is a proteinogenic amino acid in humans.',
              supports: 'endogenous cellular compound classification',
            },
          ],
        },
      ]),
    });

    expect(gate).toMatchObject({ checked: true, passed: true, findings: [] });
  });
});
