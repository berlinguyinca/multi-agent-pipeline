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

  it('does not gate answer-only agents without tools', () => {
    expect(shouldGateStep(makeAgent({ output: { type: 'answer' } }))).toBe(false);
  });

  it('does not gate data-only agents without tools', () => {
    expect(shouldGateStep(makeAgent({ output: { type: 'data' } }))).toBe(false);
  });

  it('gates agents with both files and shell', () => {
    expect(shouldGateStep(makeAgent({
      output: { type: 'files' },
      tools: [{ type: 'builtin', name: 'shell' }],
    }))).toBe(true);
  });

  it('does not gate agents with only file-read tools', () => {
    expect(shouldGateStep(makeAgent({
      tools: [{ type: 'builtin', name: 'file-read' }],
    }))).toBe(false);
  });

  it('gates agents with only MCP tools', () => {
    expect(shouldGateStep(makeAgent({
      tools: [{ type: 'mcp', uri: 'http://example.com' }],
    }))).toBe(true);
  });
});
