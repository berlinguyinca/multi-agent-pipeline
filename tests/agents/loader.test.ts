// tests/agents/loader.test.ts
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { loadAgentFromDirectory } from '../../src/agents/loader.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const INVALID_FIXTURES = path.join(import.meta.dirname, 'invalid-fixtures');

describe('loadAgentFromDirectory', () => {
  it('loads a valid agent with stage prompts', async () => {
    const agent = await loadAgentFromDirectory(path.join(FIXTURES, 'valid-agent'));

    expect(agent.name).toBe('test-agent');
    expect(agent.description).toBe('A test agent for validation');
    expect(agent.adapter).toBe('claude');
    expect(agent.model).toBe('sonnet');
    expect(agent.prompt).toContain('You are a test agent');
    expect(agent.pipeline).toHaveLength(2);
    expect(agent.pipeline[0].name).toBe('analyze');
    expect(agent.pipeline[0].prompt).toContain('Analyze the input carefully');
    expect(agent.pipeline[1].name).toBe('summarize');
    expect(agent.pipeline[1].prompt).toBeUndefined();
    expect(agent.handles).toBe('test tasks');
    expect(agent.output.type).toBe('answer');
    expect(agent.tools).toHaveLength(1);
    expect(agent.tools[0].type).toBe('builtin');
    expect(agent.contract?.mission).toBe('Turn test inputs into a precise, reviewable answer.');
    expect(agent.prompt).toContain('## Role Contract');
    expect(agent.prompt).toContain('Mission: Turn test inputs into a precise, reviewable answer.');
    expect(agent.prompt).toContain('Capabilities:');
    expect(agent.prompt).toContain('Handoff deliverable: Markdown answer');
  });

  it('loads a minimal agent', async () => {
    const agent = await loadAgentFromDirectory(path.join(FIXTURES, 'minimal-agent'));

    expect(agent.name).toBe('minimal');
    expect(agent.adapter).toBe('ollama');
    expect(agent.model).toBe('gemma4');
    expect(agent.prompt).toContain('minimal agent');
    expect(agent.pipeline).toHaveLength(1);
    expect(agent.tools).toEqual([]);
    expect(agent.contract).toBeUndefined();
  });

  it('throws for missing agent.yaml', async () => {
    await expect(
      loadAgentFromDirectory(path.join(FIXTURES, 'nonexistent')),
    ).rejects.toThrow();
  });

  it('throws for an invalid contract shape', async () => {
    await expect(
      loadAgentFromDirectory(path.join(INVALID_FIXTURES, 'invalid-contract-agent')),
    ).rejects.toThrow('Invalid agent definition');
  });
});
