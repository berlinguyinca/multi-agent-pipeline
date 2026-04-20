import { describe, expect, it } from 'vitest';
import { auditEvidenceText, buildDraftClaimEvidenceLedger, runEvidenceGate } from '../../src/orchestrator/evidence-gate.js';
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

  it('accepts common retrievedAt misspellings from model-generated ledgers', () => {
    const gate = runEvidenceGate({
      step,
      config: {
        enabled: true,
        mode: 'strict',
        requiredAgents: ['usage-classification-tree'],
        currentClaimMaxSourceAgeDays: 730,
        freshnessProfiles: {},
        requireRetrievedAtForWebClaims: true,
        blockUnsupportedCurrentClaims: true,
        remediationMaxRetries: 0,
      },
      result: resultWithClaims([
        {
          id: 'claim-1',
          claim: 'Cocaine metabolites are utilized in metabolomics for toxicity and exposure assessment.',
          claimType: 'usage-classification',
          confidence: 'high',
          timeframe: 'current',
          recencyStatus: 'current',
          evidence: [
            {
              sourceType: 'url',
              retrieredAt: '2026-04-19',
              summary: 'Current metabolomics usage evidence.',
              supports: 'usage-classification',
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


  it('warns without failing when a sub-high commonness score has weak currentness evidence', () => {
    const gate = runEvidenceGate({
      step,
      config: {
        enabled: true,
        mode: 'strict',
        requiredAgents: ['usage-classification-tree'],
        currentClaimMaxSourceAgeDays: 730,
        freshnessProfiles: { 'usage-commonness': 730 },
        requireRetrievedAtForWebClaims: true,
        blockUnsupportedCurrentClaims: true,
        remediationMaxRetries: 0,
      },
      result: resultWithClaims([
        {
          id: 'claim-low-commonness',
          claim: 'A specialized use is less common today.',
          claimType: 'commonness-score',
          confidence: 'medium',
          timeframe: 'current',
          recencyStatus: 'current',
          commonnessScore: 40,
          evidence: [{ sourceType: 'document', publishedAt: '2010', summary: 'older specialty use', supports: 'specialty use' }],
        },
      ]),
    });

    expect(gate.passed).toBe(true);
    expect(gate.findings).toEqual([
      expect.objectContaining({ severity: 'medium', message: 'Current claims require direct current/recent supporting evidence.' }),
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


  it('parses wrapped ledger strings and common retrievedAt typos from live model output', () => {
    const gate = auditEvidenceText([
      '# Usage Classification Tree',
      '',
      '## Claim Evidence Ledger',
      '```json',
      '{"claims":[{"id":"claim-1","claim":"Cocaine metabolites are used as biomarkers in wastewater-based',
      'epidemiology.","claimType":"commonness-score","confidence":"high","timeframe":"current","recencyStatus":"current","commonnessScore":70,"evidence":[{"sourceType":"url","title":"Current WBE review","url":"https://example.test/wbe"https://example.test/duplicate","retrophiedAt":"2026-04-19","publishedAt":"2024","summary":"current prevalence monitoring evidence","supports":"current widespread prevalence monitoring"}]}]}',
      '```',
    ].join('\n'), {
      enabled: true,
      mode: 'strict',
      requiredAgents: ['usage-classification-tree'],
      currentClaimMaxSourceAgeDays: 730,
      freshnessProfiles: { 'usage-commonness': 730 },
      requireRetrievedAtForWebClaims: true,
      blockUnsupportedCurrentClaims: true,
      remediationMaxRetries: 0,
    });

    expect(gate?.passed).toBe(true);
    expect(gate?.claims[0]?.evidence[0]?.retrievedAt).toBe('2026-04-19');
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
