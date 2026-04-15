// tests/router/prompt-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildRouterPrompt } from '../../src/router/prompt-builder.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';

describe('buildRouterPrompt', () => {
  const agents = new Map<string, AgentDefinition>([
    ['researcher', {
      name: 'researcher',
      description: 'Synthesizes answers from research',
      adapter: 'claude',
      prompt: 'You are a researcher.',
      pipeline: [{ name: 'research' }, { name: 'summarize' }],
      handles: 'research questions, knowledge synthesis',
      output: { type: 'answer' },
      tools: [],
    }],
    ['coder', {
      name: 'coder',
      description: 'Full spec-to-code lifecycle',
      adapter: 'claude',
      prompt: 'You implement software.',
      pipeline: [{ name: 'spec' }, { name: 'execute' }],
      handles: 'code implementation, features, bug fixes',
      output: { type: 'files' },
      tools: [],
    }],
  ]);

  it('includes all agent names in prompt', () => {
    const prompt = buildRouterPrompt(agents, 'Build a REST API');
    expect(prompt).toContain('researcher');
    expect(prompt).toContain('coder');
  });

  it('includes agent handles descriptions', () => {
    const prompt = buildRouterPrompt(agents, 'Build a REST API');
    expect(prompt).toContain('research questions, knowledge synthesis');
    expect(prompt).toContain('code implementation, features, bug fixes');
  });

  it('includes the user task', () => {
    const prompt = buildRouterPrompt(agents, 'Build a REST API');
    expect(prompt).toContain('Build a REST API');
  });

  it('strips terminal chrome from the user task before embedding it', () => {
    const prompt = buildRouterPrompt(
      agents,
      '╭────────────────╮\n│ Hello world │\n╰────────────────╯',
    );

    expect(prompt).toContain('Hello world');
    expect(prompt).not.toContain('╭');
    expect(prompt).not.toContain('╰');
    expect(prompt).not.toContain('│');
  });

  it('requests JSON output with plan array', () => {
    const prompt = buildRouterPrompt(agents, 'test');
    expect(prompt).toContain('"plan"');
    expect(prompt).toContain('"id"');
    expect(prompt).toContain('"agent"');
    expect(prompt).toContain('"task"');
    expect(prompt).toContain('"dependsOn"');
  });

  it('allows the router to return a no-match result', () => {
    const prompt = buildRouterPrompt(agents, 'test');
    expect(prompt).toContain('"kind":"no-match"');
    expect(prompt).toContain('"reason"');
    expect(prompt).toContain('"suggestedAgent"');
  });

  it('enforces maxSteps', () => {
    const prompt = buildRouterPrompt(agents, 'test', 5);
    expect(prompt).toContain('5');
  });
});
