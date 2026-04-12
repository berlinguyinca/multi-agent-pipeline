import { describe, it, expect } from 'vitest';
import { OllamaAdapter } from '../../src/adapters/ollama-adapter.js';
import { AdapterError } from '../../src/adapters/base-adapter.js';

describe('OllamaAdapter', () => {
  it('has type ollama', () => {
    const adapter = new OllamaAdapter('hermes');
    expect(adapter.type).toBe('ollama');
  });

  it('stores model name', () => {
    const adapter = new OllamaAdapter('deepseek-coder:latest');
    expect(adapter.model).toBe('deepseek-coder:latest');
  });

  it('throws AdapterError when model is not set', async () => {
    const adapter = new OllamaAdapter();
    const gen = adapter.run('test');
    await expect(gen.next()).rejects.toThrow('requires a model name');
  });

  it('detects ollama binary', async () => {
    const adapter = new OllamaAdapter();
    const info = await adapter.detect();
    // On this machine, ollama is installed
    expect(typeof info.installed).toBe('boolean');
    if (info.installed) {
      expect(Array.isArray(info.models)).toBe(true);
    }
  });
});
