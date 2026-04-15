// tests/types/agent-definition.test.ts
import { describe, it, expect } from 'vitest';
import type {
  AgentDefinition,
  AgentToolConfig,
  AgentStageConfig,
  OutputType,
} from '../../src/types/agent-definition.js';
import { isValidAgentDefinition } from '../../src/types/agent-definition.js';

describe('AgentDefinition types', () => {
  it('validates a minimal agent definition', () => {
    const agent: AgentDefinition = {
      name: 'researcher',
      description: 'Synthesizes answers from research',
      adapter: 'claude',
      prompt: 'You are a research specialist.',
      pipeline: [{ name: 'research' }],
      handles: 'research questions, knowledge synthesis',
      output: { type: 'answer' },
      tools: [],
    };
    expect(isValidAgentDefinition(agent)).toBe(true);
  });

  it('validates agent with model and stage prompts', () => {
    const agent: AgentDefinition = {
      name: 'database',
      description: 'Executes database queries',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'You are a database expert.',
      pipeline: [
        { name: 'validate-query', prompt: 'Validate the SQL.' },
        { name: 'execute' },
        { name: 'format-results', prompt: 'Format as markdown table.' },
      ],
      handles: 'SQL queries, database schema',
      output: { type: 'data' },
      tools: [
        { type: 'builtin', name: 'db-connection', config: { dialect: 'postgres' } },
        { type: 'mcp', uri: 'mcp://localhost:5432/pg-tools' },
      ],
    };
    expect(isValidAgentDefinition(agent)).toBe(true);
  });

  it('validates presentation output agents', () => {
    const agent: AgentDefinition = {
      name: 'presentation-designer',
      description: 'Builds slide decks and supporting assets',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'You create polished presentations.',
      pipeline: [{ name: 'plan-deck' }, { name: 'build-deck' }],
      handles: 'powerpoint decks, executive presentations, visuals',
      output: { type: 'presentation' },
      tools: [
        { type: 'builtin', name: 'shell' },
        { type: 'builtin', name: 'web-search' },
      ],
    };
    expect(isValidAgentDefinition(agent)).toBe(true);
  });

  it('rejects agent without name', () => {
    const agent = {
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [{ name: 'step1' }],
      handles: 'test',
      output: { type: 'answer' },
      tools: [],
    };
    expect(isValidAgentDefinition(agent as AgentDefinition)).toBe(false);
  });

  it('rejects agent with empty pipeline', () => {
    const agent: AgentDefinition = {
      name: 'bad',
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [],
      handles: 'test',
      output: { type: 'answer' },
      tools: [],
    };
    expect(isValidAgentDefinition(agent)).toBe(false);
  });

  it('rejects agent with invalid output type', () => {
    const agent = {
      name: 'bad',
      description: 'test',
      adapter: 'claude',
      prompt: 'test',
      pipeline: [{ name: 'step1' }],
      handles: 'test',
      output: { type: 'unknown' },
      tools: [],
    };
    expect(isValidAgentDefinition(agent as AgentDefinition)).toBe(false);
  });
});
