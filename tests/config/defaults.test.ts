import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

describe('DEFAULT_CONFIG', () => {
  it('assigns claude adapter to spec stage', () => {
    expect(DEFAULT_CONFIG.agents.spec.adapter).toBe('claude');
  });

  it('assigns codex adapter to review stage', () => {
    expect(DEFAULT_CONFIG.agents.review.adapter).toBe('codex');
  });

  it('assigns codex adapter to QA stage', () => {
    expect(DEFAULT_CONFIG.agents.qa.adapter).toBe('codex');
  });

  it('assigns claude adapter to execute stage', () => {
    expect(DEFAULT_CONFIG.agents.execute.adapter).toBe('claude');
  });

  it('assigns claude adapter to docs stage', () => {
    expect(DEFAULT_CONFIG.agents.docs.adapter).toBe('claude');
  });

  it('defaults outputDir to ./output', () => {
    expect(DEFAULT_CONFIG.outputDir).toBe('./output');
  });

  it('defaults gitCheckpoints to true', () => {
    expect(DEFAULT_CONFIG.gitCheckpoints).toBe(true);
  });

  it('defaults Ollama host to localhost', () => {
    expect(DEFAULT_CONFIG.ollama.host).toBe('http://localhost:11434');
  });

  it('defaults Ollama server startup resources for local agent workloads', () => {
    expect(DEFAULT_CONFIG.ollama.contextLength).toBe(100000);
    expect(DEFAULT_CONFIG.ollama.numParallel).toBe(2);
    expect(DEFAULT_CONFIG.ollama.maxLoadedModels).toBe(2);
  });

  it('defaults QA loop limits', () => {
    expect(DEFAULT_CONFIG.quality.maxSpecQaIterations).toBe(3);
    expect(DEFAULT_CONFIG.quality.maxCodeQaIterations).toBe(3);
  });

  it('enables evidence gates for fact-critical agents by default', () => {
    expect(DEFAULT_CONFIG.evidence).toMatchObject({
      enabled: true,
      mode: 'strict',
      currentClaimMaxSourceAgeDays: 730,
      requireRetrievedAtForWebClaims: true,
      blockUnsupportedCurrentClaims: true,
      remediationMaxRetries: 1,
    });
    expect(DEFAULT_CONFIG.evidence.requiredAgents).toEqual([
      'usage-classification-tree',
      'researcher',
      'classyfire-taxonomy-classifier',
      'security-advisor',
      'release-readiness-reviewer',
    ]);
    expect(DEFAULT_CONFIG.evidence.freshnessProfiles).toMatchObject({
      'usage-commonness': 730,
      software: 180,
      medical: 365,
      'chemical-taxonomy': 3650,
    });
  });

  it('enables router consensus by default', () => {
    expect(DEFAULT_CONFIG.router.consensus).toEqual({
      enabled: true,
      models: [],
      scope: 'router',
      mode: 'majority',
    });
  });

  it('keeps local agent consensus opt-in to avoid slow local-model stalls', () => {
    expect(DEFAULT_CONFIG.agentConsensus).toEqual({
      enabled: false,
      runs: 3,
      outputTypes: ['answer', 'data', 'presentation'],
      minSimilarity: 0.35,
      perAgent: {
        researcher: { enabled: true, runs: 3, outputTypes: ['answer'], minSimilarity: 0.35 },
        'classyfire-taxonomy-classifier': { enabled: true, runs: 3, outputTypes: ['answer'], minSimilarity: 0.35 },
        'usage-classification-tree': { enabled: true, runs: 3, outputTypes: ['answer'], minSimilarity: 0.35 },
      },
      fileOutputs: {
        enabled: false,
        runs: 3,
        isolation: 'git-worktree',
        keepWorktreesOnFailure: true,
        verificationCommands: [],
        selection: 'best-passing-minimal-diff',
      },
    });
  });

  it('enables autonomous cross-review for high-impact gates by default', () => {
    expect(DEFAULT_CONFIG.crossReview.enabled).toBe(true);
    expect(DEFAULT_CONFIG.crossReview.defaultHighImpactOnly).toBe(true);
    expect(DEFAULT_CONFIG.crossReview.autonomy).toBe('nonblocking');
    expect(DEFAULT_CONFIG.crossReview.maxRounds).toBe(2);
    expect(DEFAULT_CONFIG.crossReview.maxRoundsUpperBound).toBe(5);
    expect(DEFAULT_CONFIG.crossReview.judge.preferSeparatePanel).toBe(true);
    expect(DEFAULT_CONFIG.crossReview.gates).toMatchObject({
      planning: true,
      routing: true,
      architecture: true,
      apiContract: true,
      fileOutputs: true,
      security: true,
      releaseReadiness: true,
      verificationFailure: true,
    });
  });

  it('uses a bounded step retry default instead of hour-scale timeout backoff', () => {
    expect(DEFAULT_CONFIG.router.maxStepRetries).toBe(1);
  });

  it('disables the LLM output formatter by default', () => {
    expect(DEFAULT_CONFIG.agentOverrides['output-formatter']).toEqual({ enabled: false });
  });
});
