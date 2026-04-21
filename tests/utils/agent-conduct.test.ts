import { describe, expect, it } from 'vitest';
import { AGENT_CONDUCT_PROMPT } from '../../src/utils/agent-conduct.js';

describe('agent conduct prompt', () => {
  it('treats refined prompts with provided answers as complete enough to execute', () => {
    expect(AGENT_CONDUCT_PROMPT).toContain('Answers provided');
    expect(AGENT_CONDUCT_PROMPT).toContain('treat clarification as complete');
    expect(AGENT_CONDUCT_PROMPT).toContain('reasonable assumptions');
  });
});
