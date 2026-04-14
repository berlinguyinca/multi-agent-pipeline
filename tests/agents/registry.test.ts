// tests/agents/registry.test.ts
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { loadAgentRegistry, mergeWithOverrides } from '../../src/agents/registry.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

describe('loadAgentRegistry', () => {
  it('discovers all agents in a directory', async () => {
    const agents = await loadAgentRegistry(FIXTURES);

    expect(agents.size).toBeGreaterThanOrEqual(2);
    expect(agents.has('test-agent')).toBe(true);
    expect(agents.has('minimal')).toBe(true);
  });

  it('returns empty map for empty directory', async () => {
    const tmpDir = path.join(FIXTURES, '..', 'empty-agents-dir');
    const fs = await import('fs/promises');
    await fs.mkdir(tmpDir, { recursive: true });

    const agents = await loadAgentRegistry(tmpDir);
    expect(agents.size).toBe(0);

    await fs.rmdir(tmpDir);
  });
});

describe('mergeWithOverrides', () => {
  it('overrides scalar fields', () => {
    const base: AgentDefinition = {
      name: 'test',
      description: 'base',
      adapter: 'claude',
      model: 'sonnet',
      prompt: 'base prompt',
      pipeline: [{ name: 'step1' }],
      handles: 'test',
      output: { type: 'answer' },
      tools: [],
    };

    const overrides = { model: 'opus', adapter: 'codex' as const };
    const merged = mergeWithOverrides(base, overrides);

    expect(merged.model).toBe('opus');
    expect(merged.adapter).toBe('codex');
    expect(merged.description).toBe('base');
  });

  it('extends tools by name', () => {
    const base: AgentDefinition = {
      name: 'test',
      description: 'base',
      adapter: 'claude',
      prompt: 'prompt',
      pipeline: [{ name: 'step1' }],
      handles: 'test',
      output: { type: 'files' },
      tools: [{ type: 'builtin', name: 'shell' }],
    };

    const overrides = {
      tools: [
        { type: 'builtin' as const, name: 'shell', config: { allowedCommands: ['ls'] } },
        { type: 'builtin' as const, name: 'http-api', config: { baseUrl: 'https://api.example.com' } },
      ],
    };
    const merged = mergeWithOverrides(base, overrides);

    expect(merged.tools).toHaveLength(2);
    const shell = merged.tools.find((t) => t.type === 'builtin' && t.name === 'shell');
    expect(shell).toBeDefined();
    expect(shell!.type === 'builtin' && shell!.config).toEqual({ allowedCommands: ['ls'] });
  });

  it('sets enabled: false to exclude agent', () => {
    const base: AgentDefinition = {
      name: 'test',
      description: 'base',
      adapter: 'claude',
      prompt: 'prompt',
      pipeline: [{ name: 'step1' }],
      handles: 'test',
      output: { type: 'answer' },
      tools: [],
    };

    const merged = mergeWithOverrides(base, { enabled: false });
    expect(merged.enabled).toBe(false);
  });
});
