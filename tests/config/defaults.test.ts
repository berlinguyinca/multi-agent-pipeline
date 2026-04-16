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

  it('defaults QA loop limits', () => {
    expect(DEFAULT_CONFIG.quality.maxSpecQaIterations).toBe(3);
    expect(DEFAULT_CONFIG.quality.maxCodeQaIterations).toBe(3);
  });

  it('enables router consensus by default', () => {
    expect(DEFAULT_CONFIG.router.consensus).toEqual({
      enabled: true,
      models: [],
      scope: 'router',
      mode: 'majority',
    });
  });

  it('enables local agent consensus by default for non-file outputs', () => {
    expect(DEFAULT_CONFIG.agentConsensus).toEqual({
      enabled: true,
      runs: 3,
      outputTypes: ['answer', 'data', 'presentation'],
      minSimilarity: 0.35,
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
});
