import { describe, it, expect } from 'vitest';
import { injectToolCatalog } from '../../src/tools/inject.js';
import type { Tool } from '../../src/tools/types.js';

describe('injectToolCatalog', () => {
  const mockTool: Tool = { name: 'shell', description: 'Execute commands', parameters: [{ name: 'command', type: 'string', description: 'The command', required: true }], execute: async () => ({ success: true, output: '' }) };

  it('appends tool catalog to prompt', () => {
    const result = injectToolCatalog('Your task: do something', [mockTool]);
    expect(result).toContain('Your task: do something');
    expect(result).toContain('Available Tools');
    expect(result).toContain('shell');
  });

  it('returns original prompt when no tools', () => {
    expect(injectToolCatalog('Your task: do something', [])).toBe('Your task: do something');
  });

  it('includes agent system prompt before task', () => {
    const result = injectToolCatalog('task', [mockTool], 'You are a database expert.');
    expect(result).toContain('You are a database expert.');
    expect(result.indexOf('database expert')).toBeLessThan(result.indexOf('task'));
  });
});
