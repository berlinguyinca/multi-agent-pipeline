import { describe, expect, it } from 'vitest';
import { buildDraftClaimEvidenceLedger, runEvidenceGate } from '../../src/orchestrator/evidence-gate.js';
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

  it('builds a low-confidence draft ledger from prose when ledger is missing', () => {
    const draft = buildDraftClaimEvidenceLedger('# Report\n\nHistorical use was very common in 1820.\n\nShort.');

    expect(draft).toEqual([
      expect.objectContaining({
        id: 'draft-1',
        claimType: 'commonness-score',
        confidence: 'low',
      }),
    ]);
  });

  it('supports warning mode without failing the gate', () => {
    const gate = runEvidenceGate({
      step,
      config: {
        enabled: true,
        mode: 'warn',
        requiredAgents: ['usage-classification-tree'],
        currentClaimMaxSourceAgeDays: 730,
        freshnessProfiles: { 'usage-commonness': 730 },
        requireRetrievedAtForWebClaims: true,
        blockUnsupportedCurrentClaims: true,
        remediationMaxRetries: 0,
      },
      result: resultWithClaims([
        {
          id: 'claim-1',
          claim: 'Historical use is common today.',
          claimType: 'commonness-score',
          confidence: 'medium',
          timeframe: 'historical',
          recencyStatus: 'historical',
          commonnessScore: 90,
          evidence: [{ sourceType: 'document', publishedAt: '1820', summary: 'historical use', supports: 'historical use' }],
        },
      ]),
    });

    expect(gate.passed).toBe(true);
    expect(gate.findings[0]?.severity).toBe('high');
  });

  it('uses claim-type freshness profiles', () => {
    const gate = runEvidenceGate({
      step,
      config: {
        enabled: true,
        mode: 'strict',
        requiredAgents: ['usage-classification-tree'],
        currentClaimMaxSourceAgeDays: 730,
        freshnessProfiles: { software: 30 },
        requireRetrievedAtForWebClaims: true,
        blockUnsupportedCurrentClaims: true,
        remediationMaxRetries: 0,
      },
      result: resultWithClaims([
        {
          id: 'claim-sw',
          claim: 'Software behavior is current.',
          claimType: 'documentation',
          confidence: 'high',
          timeframe: 'current',
          recencyStatus: 'current',
          evidence: [{
            sourceType: 'url',
            retrievedAt: '2026-04-18',
            publishedAt: '2025-01-01',
            summary: 'current documentation',
            supports: 'current behavior',
          }],
        },
      ]),
    });

    expect(gate.passed).toBe(false);
    expect(gate.findings.map((finding) => finding.message)).toContain('Current claims require direct current/recent supporting evidence.');
  });
});
