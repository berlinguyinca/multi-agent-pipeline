import { describe, expect, it } from 'vitest';
import { DEFAULT_CROSS_REVIEW_CONFIG } from '../../src/config/defaults.js';
import {
  buildCrossReviewJudgeStep,
  buildCrossReviewReviewStep,
  buildCrossReviewRevisionStep,
  collectCrossReviewLedgers,
  isCrossReviewHelperStep,
  parseCrossReviewJudgeDecision,
  shouldCrossReviewStep,
  summarizeCrossReviewLedgers,
} from '../../src/orchestrator/cross-review.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { CrossReviewLedger, DAGStep, StepResult } from '../../src/types/dag.js';

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'code-writer',
    description: 'Writes code',
    adapter: 'codex',
    prompt: 'Write code',
    pipeline: [{ name: 'run' }],
    handles: 'code tasks',
    output: { type: 'answer' },
    tools: [],
    ...overrides,
  };
}

function step(overrides: Partial<DAGStep> = {}): DAGStep {
  return {
    id: 'step-1',
    agent: 'code-writer',
    task: 'Implement the feature',
    dependsOn: [],
    ...overrides,
  };
}

function ledger(overrides: Partial<CrossReviewLedger> = {}): CrossReviewLedger {
  return {
    rootStepId: 'step-1',
    round: 1,
    gate: 'fileOutputs',
    status: 'accepted',
    participants: [],
    residualRisks: [],
    budgetExhausted: false,
    ...overrides,
  };
}

function result(overrides: Partial<StepResult> = {}): StepResult {
  return {
    id: 'step-1',
    agent: 'code-writer',
    task: 'Implement the feature',
    status: 'completed',
    outputType: 'answer',
    output: 'Completed implementation notes.',
    ...overrides,
  };
}

describe('cross-review planning helpers', () => {
  it('selects file-output steps with the fileOutputs gate', () => {
    const decision = shouldCrossReviewStep({
      config: DEFAULT_CROSS_REVIEW_CONFIG,
      step: step(),
      result: result({ outputType: 'files', output: '' }),
      agent: agent({ output: { type: 'files' } }),
      round: 1,
    });

    expect(decision).toMatchObject({ shouldReview: true, gate: 'fileOutputs' });
  });

  it('does not select generated cross-review helper steps', () => {
    expect(isCrossReviewHelperStep({ id: 'step-1-peer-review-1' })).toBe(true);

    const decision = shouldCrossReviewStep({
      config: DEFAULT_CROSS_REVIEW_CONFIG,
      step: step({ id: 'step-1-peer-review-1' }),
      result: result({ id: 'step-1-peer-review-1' }),
      agent: agent(),
      round: 1,
    });

    expect(decision.shouldReview).toBe(false);
  });

  it('builds visible peer-review and judge helper DAG steps with required instructions', () => {
    const original = step();
    const sourceResult = result({ output: 'Created src/example.ts and tests.' });
    const reviewStep = buildCrossReviewReviewStep({
      step: original,
      result: sourceResult,
      reviewerAgent: 'peer-reviewer',
      round: 1,
      gate: 'fileOutputs',
    });
    const judgeStep = buildCrossReviewJudgeStep({
      step: original,
      result: sourceResult,
      reviewStepId: reviewStep.id,
      judgeAgent: 'cross-review-judge',
      round: 1,
      gate: 'fileOutputs',
    });

    expect(reviewStep).toMatchObject({
      id: 'step-1-peer-review-1',
      agent: 'peer-reviewer',
      dependsOn: ['step-1'],
      parentStepId: 'step-1',
    });
    expect(reviewStep.task).toContain('Return a concise structured cross-review critique');
    expect(reviewStep.task).toContain('do not ask the user to choose between models');

    expect(judgeStep).toMatchObject({
      id: 'step-1-judge-1',
      agent: 'cross-review-judge',
      dependsOn: ['step-1', 'step-1-peer-review-1'],
      parentStepId: 'step-1',
    });
    expect(judgeStep.task).toContain('Return ONLY JSON');
    expect(judgeStep.task).toContain('decision');
    expect(judgeStep.task).toContain('rationale');
    expect(judgeStep.task).toContain('remediation');
    expect(judgeStep.task).toContain('residualRisks');
  });

  it('parses judge JSON decisions and degrades invalid JSON without throwing', () => {
    expect(parseCrossReviewJudgeDecision(
      '{"decision":"revise","rationale":"tests missing","remediation":["add regression test"],"residualRisks":["coverage gap"]}',
    )).toEqual({
      decision: 'revise',
      rationale: 'tests missing',
      remediation: ['add regression test'],
      residualRisks: ['coverage gap'],
    });

    expect(parseCrossReviewJudgeDecision('not json')).toMatchObject({
      decision: 'degraded',
      remediation: [],
      residualRisks: [],
    });
  });

  it('parses the first valid judge JSON object after preamble braces', () => {
    const decision = parseCrossReviewJudgeDecision(
      'Preamble contains {not json} before the real payload: {\"decision\":\"accept\",\"rationale\":\"review passed\",\"remediation\":[],\"residualRisks\":[\"minor follow-up\"]}',
    );

    expect(decision).toEqual({
      decision: 'accept',
      rationale: 'review passed',
      remediation: [],
      residualRisks: ['minor follow-up'],
    });
  });

  it('collects cross-review ledgers from step results', () => {
    const acceptedLedger = ledger({ rootStepId: 'step-1', status: 'accepted' });
    const degradedLedger = ledger({ rootStepId: 'step-3', status: 'degraded', judgeDecision: 'degraded' });

    expect(collectCrossReviewLedgers([
      result({ id: 'step-1', crossReview: acceptedLedger }),
      result({ id: 'step-2' }),
      result({ id: 'step-3', crossReview: degradedLedger }),
    ])).toEqual([acceptedLedger, degradedLedger]);
  });

  it('summarizes cross-review ledgers by outcome counts', () => {
    const ledgers = [
      ledger({ rootStepId: 'accepted-by-status', status: 'accepted' }),
      ledger({ rootStepId: 'accepted-by-decision', status: 'pending', judgeDecision: 'accept' }),
      ledger({ rootStepId: 'revised-by-status', status: 'revised' }),
      ledger({ rootStepId: 'revised-by-decision', status: 'pending', judgeDecision: 'revise' }),
      ledger({ rootStepId: 'degraded-by-status', status: 'degraded' }),
      ledger({ rootStepId: 'degraded-by-decision', status: 'pending', judgeDecision: 'degraded' }),
      ledger({ rootStepId: 'budget-by-status', status: 'budget-exhausted', budgetExhausted: false }),
      ledger({ rootStepId: 'budget-by-flag', status: 'pending', budgetExhausted: true }),
    ];

    expect(summarizeCrossReviewLedgers(ledgers)).toMatchObject({
      enabled: true,
      totalReviewed: 8,
      accepted: 2,
      revised: 2,
      degraded: 2,
      budgetExhausted: 2,
      ledgers,
    });
  });

  it('builds revision helper DAG steps with the original agent and remediation bullets', () => {
    const revisionStep = buildCrossReviewRevisionStep({
      step: step(),
      judgeStepId: 'step-1-judge-1',
      round: 1,
      remediation: ['add regression test', 'document residual coverage gap'],
    });

    expect(revisionStep).toMatchObject({
      id: 'step-1-revision-1',
      agent: 'code-writer',
      dependsOn: ['step-1-judge-1'],
      parentStepId: 'step-1',
    });
    expect(revisionStep.task).toContain('- add regression test');
    expect(revisionStep.task).toContain('- document residual coverage gap');
  });
});
