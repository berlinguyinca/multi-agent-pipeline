import { describe, it, expect } from 'vitest';
import { validatePrompt, MIN_WORDS } from '../../src/utils/prompt-validation.js';

describe('validatePrompt', () => {
  it('rejects empty prompt', () => {
    const result = validatePrompt('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('0/');
  });

  it('rejects single word', () => {
    const result = validatePrompt('test');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('1/');
  });

  it('rejects prompt with fewer than MIN_WORDS words', () => {
    const result = validatePrompt('build a CLI');
    expect(result.valid).toBe(false);
    expect(result.error).toContain(`3/${MIN_WORDS}`);
  });

  it('accepts prompt with exactly MIN_WORDS words', () => {
    const prompt = Array.from({ length: MIN_WORDS }, (_, i) => `word${i}`).join(' ');
    const result = validatePrompt(prompt);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts prompt with more than MIN_WORDS words', () => {
    const result = validatePrompt(
      'Build a TypeScript CLI that converts CSV files to JSON format with proper error handling and tests',
    );
    expect(result.valid).toBe(true);
  });

  it('trims whitespace before counting', () => {
    const result = validatePrompt('   test   ');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('1/');
  });

  it('handles multiple spaces between words', () => {
    const result = validatePrompt('one  two   three    four');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('4/');
  });

  it('bypasses validation when GitHub issue URL is provided', () => {
    const result = validatePrompt('', 'https://github.com/org/repo/issues/1');
    expect(result.valid).toBe(true);
  });

  it('bypasses validation when YouTrack issue URL is provided', () => {
    const result = validatePrompt('', undefined, undefined, {
      youtrackIssueUrl: 'https://wcmc.myjetbrains.com/youtrack/issue/MAP-123',
    });
    expect(result.valid).toBe(true);
  });

  it('bypasses validation when a spec file path is provided', () => {
    const result = validatePrompt('', undefined, 'docs/spec.md');
    expect(result.valid).toBe(true);
  });

  it('bypasses validation with short prompt when GitHub issue URL is provided', () => {
    const result = validatePrompt('test', 'https://github.com/org/repo/issues/1');
    expect(result.valid).toBe(true);
  });

  it('allows mixing prompt text with a spec file when requested', () => {
    const result = validatePrompt('build a CLI from this', undefined, 'docs/spec.md', {
      allowPromptWithSpecFile: true,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects mixing prompt text with a spec file by default', () => {
    const result = validatePrompt('build a CLI from this', undefined, 'docs/spec.md');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('--spec-file');
  });

  it('rejects mixing a GitHub issue with a spec file', () => {
    const result = validatePrompt('', 'https://github.com/org/repo/issues/1', 'docs/spec.md');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('--github-issue');
  });

  it('rejects mixing a YouTrack issue with a spec file', () => {
    const result = validatePrompt('', undefined, 'docs/spec.md', {
      youtrackIssueUrl: 'MAP-123',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('--youtrack-issue');
  });

  it('does not bypass validation for empty GitHub URL', () => {
    const result = validatePrompt('test', '');
    expect(result.valid).toBe(false);
  });

  it('does not bypass validation for whitespace-only GitHub URL', () => {
    const result = validatePrompt('test', '   ');
    expect(result.valid).toBe(false);
  });

  it('error message mentions minimum word count', () => {
    const result = validatePrompt('test');
    expect(result.error).toContain(String(MIN_WORDS));
  });

  it('error message includes actual word count', () => {
    const result = validatePrompt('one two three');
    expect(result.error).toContain('3/');
  });

  it('MIN_WORDS is 10', () => {
    expect(MIN_WORDS).toBe(10);
  });
});
