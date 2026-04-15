import { describe, expect, it } from 'vitest';
import { buildSecurityReviewPrompt, parseLLMFindings } from '../../src/security/llm-review.js';

describe('buildSecurityReviewPrompt', () => {
  it('includes the code under review', () => {
    const prompt = buildSecurityReviewPrompt('function foo() {}', 'impl-coder', 'Build a CLI');
    expect(prompt).toContain('function foo() {}');
  });

  it('includes the agent name and task', () => {
    const prompt = buildSecurityReviewPrompt('code', 'impl-coder', 'Build a REST API');
    expect(prompt).toContain('impl-coder');
    expect(prompt).toContain('Build a REST API');
  });
});

describe('parseLLMFindings', () => {
  it('parses finding markers', () => {
    const output = [
      'SECURITY_FINDING: eval-injection | critical | eval() used with user input',
      'SECURITY_FINDING: hardcoded-secret | high | API key found on line 5',
      'SECURITY_PASSED: false',
    ].join('\n');

    const result = parseLLMFindings(output);

    expect(result.passed).toBe(false);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].rule).toBe('eval-injection');
    expect(result.findings[0].severity).toBe('critical');
  });

  it('returns passed=true when no findings exist', () => {
    const result = parseLLMFindings('SECURITY_PASSED: true\nNo security issues found.');
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('defaults to passed=false when the pass marker is absent', () => {
    const result = parseLLMFindings('SECURITY_FINDING: xss | high | innerHTML used');
    expect(result.passed).toBe(false);
  });
});
