import { describe, it, expect } from 'vitest';
import { DEFAULT_SECURITY_CONFIG } from '../../src/security/types.js';

describe('SecurityConfig', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_SECURITY_CONFIG.enabled).toBe(true);
    expect(DEFAULT_SECURITY_CONFIG.maxRemediationRetries).toBe(2);
    expect(DEFAULT_SECURITY_CONFIG.staticPatternsEnabled).toBe(true);
    expect(DEFAULT_SECURITY_CONFIG.llmReviewEnabled).toBe(true);
  });

  it('defaults to ollama adapter', () => {
    expect(DEFAULT_SECURITY_CONFIG.adapter).toBe('ollama');
  });

  it('has a default model', () => {
    expect(DEFAULT_SECURITY_CONFIG.model).toBe('gemma4:26b');
  });
});
