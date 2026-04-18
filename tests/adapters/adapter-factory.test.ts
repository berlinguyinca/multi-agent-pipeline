import { describe, it, expect } from 'vitest';
import { createAdapter } from '../../src/adapters/adapter-factory.js';
import { ClaudeAdapter } from '../../src/adapters/claude-adapter.js';
import { CodexAdapter } from '../../src/adapters/codex-adapter.js';
import { OllamaAdapter } from '../../src/adapters/ollama-adapter.js';
import { MetadataAdapter } from '../../src/adapters/metadata-adapter.js';

describe('createAdapter', () => {
  it('creates ClaudeAdapter for claude type', () => {
    const adapter = createAdapter({ type: 'claude' });
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
    expect(adapter.type).toBe('claude');
  });

  it('creates CodexAdapter for codex type', () => {
    const adapter = createAdapter({ type: 'codex' });
    expect(adapter).toBeInstanceOf(CodexAdapter);
    expect(adapter.type).toBe('codex');
  });

  it('creates OllamaAdapter for ollama type', () => {
    const adapter = createAdapter({ type: 'ollama', model: 'hermes' });
    expect(adapter).toBeInstanceOf(OllamaAdapter);
    expect(adapter.type).toBe('ollama');
    expect(adapter.model).toBe('hermes');
  });

  it('creates MetadataAdapter for metadata type', () => {
    const adapter = createAdapter({ type: 'metadata', model: 'codefetch' });
    expect(adapter).toBeInstanceOf(MetadataAdapter);
    expect(adapter.type).toBe('metadata');
    expect(adapter.model).toBe('codefetch');
  });

  it('passes model to OllamaAdapter', () => {
    const adapter = createAdapter({ type: 'ollama', model: 'deepseek-coder:latest' });
    expect(adapter.model).toBe('deepseek-coder:latest');
  });

  it('throws for unknown adapter type', () => {
    // @ts-expect-error testing invalid input
    expect(() => createAdapter({ type: 'unknown' })).toThrow('Unknown adapter type');
  });
});
