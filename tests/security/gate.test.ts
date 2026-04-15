import { describe, expect, it, vi } from 'vitest';
import { runSecurityGate } from '../../src/security/gate.js';
import type { SecurityConfig } from '../../src/security/types.js';
import type { AgentAdapter } from '../../src/types/adapter.js';

const defaultConfig: SecurityConfig = {
  enabled: true,
  maxRemediationRetries: 2,
  adapter: 'ollama',
  model: 'gemma4:26b',
  staticPatternsEnabled: true,
  llmReviewEnabled: true,
};

function mockAdapter(output: string): AgentAdapter {
  return {
    type: 'ollama',
    model: 'gemma4:26b',
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run() {
      yield output;
    },
  };
}

describe('runSecurityGate', () => {
  it('passes safe code with static-only checks', async () => {
    const result = await runSecurityGate({
      content: 'function add(a, b) { return a + b; }',
      agentName: 'impl-coder',
      task: 'Add numbers',
      config: { ...defaultConfig, llmReviewEnabled: false },
    });

    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('fails dangerous code on the static scan', async () => {
    const result = await runSecurityGate({
      content: 'eval(userInput);',
      agentName: 'impl-coder',
      task: 'Run user code',
      config: { ...defaultConfig, llmReviewEnabled: false },
    });

    expect(result.passed).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.staticFindings.length).toBeGreaterThan(0);
  });

  it('runs LLM review after static scan passes', async () => {
    const result = await runSecurityGate({
      content: 'function doSomething() { return 1; }',
      agentName: 'impl-coder',
      task: 'Do something',
      config: defaultConfig,
      createReviewAdapter: () =>
        mockAdapter(
          'SECURITY_FINDING: novel-threat | high | Suspicious pattern\nSECURITY_PASSED: false',
        ),
    });

    expect(result.passed).toBe(false);
    expect(result.llmFindings.length).toBeGreaterThan(0);
    expect(result.llmFindings[0]?.rule).toBe('novel-threat');
  });

  it('skips LLM review when disabled', async () => {
    const result = await runSecurityGate({
      content: 'function safe() { return 1; }',
      agentName: 'impl-coder',
      task: 'Safe code',
      config: { ...defaultConfig, llmReviewEnabled: false },
    });

    expect(result.passed).toBe(true);
    expect(result.llmFindings).toHaveLength(0);
  });

  it('returns immediately when security is disabled', async () => {
    const result = await runSecurityGate({
      content: 'eval(userInput);',
      agentName: 'impl-coder',
      task: 'Dangerous',
      config: { ...defaultConfig, enabled: false },
    });

    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });
});
