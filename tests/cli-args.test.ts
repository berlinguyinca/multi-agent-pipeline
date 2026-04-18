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
      '--ollama-context-length',
      '64000',
      '--ollama-num-parallel',
      '4',
      '--ollama-max-loaded-models',
      '3',
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

  it('extracts spec file path without treating it as prompt text', () => {
    const args = [
      '--headless',
      '--spec-file',
      'docs/spec.md',
      '--output-dir',
      'eval-output/demo',
    ];

    expect(extractFlag(args, '--spec-file')).toBe('docs/spec.md');
    expect(extractPrompt(args)).toBe('');
  });

  it('excludes --output-format value from the prompt', () => {
    const prompt = extractPrompt([
      '--headless',
      '--output-format',
      'markdown',
      'Build a tiny pantry CLI',
    ]);

    expect(prompt).toBe('Build a tiny pantry CLI');
  });

  it('excludes disabled agent values from the prompt', () => {
    const prompt = extractPrompt([
      '--headless',
      '--disable-agent',
      'output-formatter,researcher',
      '--disable-agents',
      'grammar-spelling-specialist',
      'Build a tiny pantry CLI',
    ]);

    expect(prompt).toBe('Build a tiny pantry CLI');
  });

  it('excludes agent comparison values from the prompt', () => {
    const prompt = extractPrompt([
      '--headless',
      '--compare-agents',
      'researcher,writer',
      '--semantic-judge',
      'Build a tiny pantry CLI',
    ]);

    expect(prompt).toBe('Build a tiny pantry CLI');
  });

  it('excludes judge panel model values from the prompt', () => {
    const prompt = extractPrompt([
      '--headless',
      '--judge-panel-models',
      'ollama/gemma4,claude/sonnet,codex/gpt-5',
      '--judge-panel-max-rounds',
      '2',
      '--judge-panel-steer',
      'Build a tiny pantry CLI',
    ]);

    expect(prompt).toBe('Build a tiny pantry CLI');
  });

  it('does not treat --classic as prompt text', () => {
    const prompt = extractPrompt([
      '--headless',
      '--classic',
      'Build a tiny pantry CLI',
    ]);

    expect(prompt).toBe('Build a tiny pantry CLI');
  });

  it('does not treat --compact as prompt text', () => {
    const prompt = extractPrompt([
      '--headless',
      '--compact',
      'Build a tiny pantry CLI',
    ]);

    expect(prompt).toBe('Build a tiny pantry CLI');
  });

  it('does not treat --graph as prompt text', () => {
    const prompt = extractPrompt([
      '--headless',
      '--graph',
      'Build a tiny pantry CLI',
    ]);

    expect(prompt).toBe('Build a tiny pantry CLI');
  });

});
