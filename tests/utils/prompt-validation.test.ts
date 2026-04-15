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

  it('bypasses validation with short prompt when GitHub issue URL is provided', () => {
    const result = validatePrompt('test', 'https://github.com/org/repo/issues/1');
    expect(result.valid).toBe(true);
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
