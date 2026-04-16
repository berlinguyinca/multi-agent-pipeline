import { describe, it, expect } from 'vitest';
import { buildAgentTestPrompt, formatAgentList } from '../../src/cli/agent-commands.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

describe('formatAgentList', () => {
  const agents = new Map<string, AgentDefinition>([
    ['researcher', { name: 'researcher', description: 'Synthesizes answers', adapter: 'ollama', model: 'gemma4', prompt: 'You research.', pipeline: [{ name: 'research' }], handles: 'research questions', output: { type: 'answer' }, tools: [] }],
    ['coder', { name: 'coder', description: 'Code implementation', adapter: 'claude', prompt: 'You code.', pipeline: [{ name: 'spec' }, { name: 'execute' }], handles: 'code implementation', output: { type: 'files' }, tools: [{ type: 'builtin', name: 'shell' }] }],
  ]);

  it('formats agents as a table', () => {
    const output = formatAgentList(agents);
    expect(output).toContain('researcher');
    expect(output).toContain('coder');
    expect(output).toContain('ollama');
    expect(output).toContain('claude');
  });

  it('shows output types', () => {
    const output = formatAgentList(agents);
    expect(output).toContain('answer');
    expect(output).toContain('files');
  });

  it('shows pipeline', () => {
    const output = formatAgentList(agents);
    expect(output).toContain('research');
    expect(output).toContain('spec');
  });

  it('returns message for empty registry', () => {
    const output = formatAgentList(new Map());
    expect(output).toContain('No agents');
  });
});

describe('buildAgentTestPrompt', () => {
  const agent: AgentDefinition = {
    name: 'researcher',
    description: 'Synthesizes answers',
    adapter: 'ollama',
    model: 'gemma4',
    prompt: 'You research.',
    pipeline: [{ name: 'research' }],
    handles: 'research questions',
    output: { type: 'answer' },
    tools: [],
  };

  it('builds a smoke-test prompt from agent metadata', () => {
    const prompt = buildAgentTestPrompt(agent);
    expect(prompt).toContain('MAP agent smoke test');
    expect(prompt).toContain('researcher');
    expect(prompt).toContain('research questions');
  });

  it('uses a caller-provided sample task', () => {
    const prompt = buildAgentTestPrompt(agent, 'Summarize queueing theory');
    expect(prompt).toContain('Summarize queueing theory');
  });
});
