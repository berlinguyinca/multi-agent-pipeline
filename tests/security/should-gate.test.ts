import { describe, it, expect } from 'vitest';
import { shouldGateStep } from '../../src/security/should-gate.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

function makeAgent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: 'test-agent',
    description: 'Test',
    adapter: 'ollama',
    prompt: '',
    pipeline: [{ name: 'run' }],
    handles: 'test',
    output: { type: 'answer' },
    tools: [],
    ...overrides,
  };
}

describe('shouldGateStep', () => {
  it('gates file-output agents', () => {
    expect(shouldGateStep(makeAgent({ output: { type: 'files' } }))).toBe(true);
  });

  it('gates shell-tool agents', () => {
    expect(shouldGateStep(makeAgent({
      tools: [{ type: 'builtin', name: 'shell' }],
    }))).toBe(true);
  });

  it('gates answer-only agents', () => {
    expect(shouldGateStep(makeAgent({ output: { type: 'answer' } }))).toBe(true);
  });

  it('gates data-only agents', () => {
    expect(shouldGateStep(makeAgent({ output: { type: 'data' } }))).toBe(true);
  });

  it('gates agents with both files and shell', () => {
    expect(shouldGateStep(makeAgent({
      output: { type: 'files' },
      tools: [{ type: 'builtin', name: 'shell' }],
    }))).toBe(true);
  });

  it('gates agents with only file-read tools', () => {
    expect(shouldGateStep(makeAgent({
      tools: [{ type: 'builtin', name: 'file-read' }],
    }))).toBe(true);
  });

  it('gates agents with only MCP tools', () => {
    expect(shouldGateStep(makeAgent({
      tools: [{ type: 'mcp', uri: 'http://example.com' }],
    }))).toBe(true);
  });
});
