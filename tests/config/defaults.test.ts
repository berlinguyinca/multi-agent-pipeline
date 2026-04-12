import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

describe('DEFAULT_CONFIG', () => {
  it('assigns claude adapter to spec stage', () => {
    expect(DEFAULT_CONFIG.agents.spec.adapter).toBe('claude');
  });

  it('assigns codex adapter to review stage', () => {
    expect(DEFAULT_CONFIG.agents.review.adapter).toBe('codex');
  });

  it('assigns claude adapter to execute stage', () => {
    expect(DEFAULT_CONFIG.agents.execute.adapter).toBe('claude');
  });

  it('defaults outputDir to ./output', () => {
    expect(DEFAULT_CONFIG.outputDir).toBe('./output');
  });

  it('defaults gitCheckpoints to true', () => {
    expect(DEFAULT_CONFIG.gitCheckpoints).toBe(true);
  });
});
