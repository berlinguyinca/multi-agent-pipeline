import { describe, it, expect } from 'vitest';
import type {
  AdapterType,
  AdapterConfig,
  AgentAdapter,
  DetectionResult,
} from '../../src/types/adapter.js';

describe('AdapterType', () => {
  it('supports claude, codex, and ollama', () => {
    const types: AdapterType[] = ['claude', 'codex', 'ollama'];
    expect(types).toHaveLength(3);
  });
});

describe('AdapterConfig', () => {
  it('requires type, optional model and apiKey', () => {
    const config: AdapterConfig = { type: 'claude' };
    expect(config.type).toBe('claude');
    expect(config.model).toBeUndefined();
    expect(config.apiKey).toBeUndefined();
  });

  it('supports ollama with model', () => {
    const config: AdapterConfig = { type: 'ollama', model: 'deepseek-coder:latest' };
    expect(config.type).toBe('ollama');
    expect(config.model).toBe('deepseek-coder:latest');
  });

  it('supports optional apiKey for fallback', () => {
    const config: AdapterConfig = { type: 'claude', apiKey: 'sk-test' };
    expect(config.apiKey).toBe('sk-test');
  });

  it('supports custom binaryPath', () => {
    const config: AdapterConfig = { type: 'codex', binaryPath: '/custom/path/codex' };
    expect(config.binaryPath).toBe('/custom/path/codex');
  });
});

describe('DetectionResult', () => {
  it('has entries for all adapter types', () => {
    const result: DetectionResult = {
      claude: { installed: true, version: '1.0.0' },
      codex: { installed: false },
      ollama: { installed: true, models: ['hermes:latest', 'codellama:7b'] },
    };
    expect(result.claude.installed).toBe(true);
    expect(result.codex.installed).toBe(false);
    expect(result.ollama.models).toHaveLength(2);
  });
});

describe('AgentAdapter interface contract', () => {
  it('mock object satisfies the interface', () => {
    const mockAdapter: AgentAdapter = {
      type: 'claude',
      model: undefined,
      detect: async () => ({ installed: true }),
      run: async function* () {
        yield 'chunk1';
        yield 'chunk2';
      },
      cancel: () => {},
    };

    expect(mockAdapter.type).toBe('claude');
    expect(typeof mockAdapter.detect).toBe('function');
    expect(typeof mockAdapter.run).toBe('function');
    expect(typeof mockAdapter.cancel).toBe('function');
  });

  it('run returns an async generator', async () => {
    const mockAdapter: AgentAdapter = {
      type: 'ollama',
      model: 'hermes',
      detect: async () => ({ installed: true, models: ['hermes'] }),
      run: async function* () {
        yield 'hello ';
        yield 'world';
      },
      cancel: () => {},
    };

    const chunks: string[] = [];
    for await (const chunk of mockAdapter.run('test prompt')) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['hello ', 'world']);
  });
});
