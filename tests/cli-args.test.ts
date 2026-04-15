import { describe, expect, it } from 'vitest';
import { extractFlag, extractPrompt } from '../src/cli-args.js';

describe('cli argument parsing', () => {
  it('keeps the prompt after boolean --headless', () => {
    const prompt = extractPrompt([
      '--headless',
      'Build a tiny pantry CLI',
      '--output-dir',
      'eval-output/demo',
    ]);

    expect(prompt).toBe('Build a tiny pantry CLI');
  });

  it('excludes values consumed by option flags from the prompt', () => {
    const prompt = extractPrompt([
      'Build',
      'pantry',
      '--output-dir',
      'eval-output/demo',
      '--total-timeout',
      '20m',
      '--router-timeout',
      '5m',
      '--github-issue',
      'https://github.com/openai/codex/issues/1',
    ]);

    expect(prompt).toBe('Build pantry');
  });

  it('extracts option flag values', () => {
    expect(extractFlag(['--output-dir', 'eval-output/demo'], '--output-dir')).toBe(
      'eval-output/demo',
    );
  });

  it('extracts github issue URL without treating it as prompt text', () => {
    const args = [
      '--headless',
      '--github-issue',
      'https://github.com/openai/codex/issues/1',
      'Extra prompt',
    ];

    expect(extractFlag(args, '--github-issue')).toBe(
      'https://github.com/openai/codex/issues/1',
    );
    expect(extractPrompt(args)).toBe('Extra prompt');
  });
});
