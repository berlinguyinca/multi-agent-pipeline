import { describe, it, expect } from 'vitest';
import { generateAgentFiles, buildCreationPrompt } from '../../src/cli/agent-create-dialog.js';

describe('buildCreationPrompt', () => {
  it('includes the agent description', () => {
    const prompt = buildCreationPrompt('Analyze financial reports');
    expect(prompt).toContain('financial reports');
    expect(prompt).toContain('agent.yaml');
    expect(prompt).toContain('prompt.md');
  });
});

describe('generateAgentFiles', () => {
  it('parses LLM output into agent.yaml and prompt.md', () => {
    const llmOutput = `---AGENT_YAML---
name: financial
description: "Analyzes financial reports"
adapter: ollama
model: gemma4
prompt: prompt.md
pipeline:
  - name: analyze
  - name: report
handles: "financial analysis, reports"
output:
  type: data
tools: []
---PROMPT_MD---
# Financial Agent

You are a financial analyst.`;

    const files = generateAgentFiles(llmOutput);
    expect(files.agentYaml).toContain('name: financial');
    expect(files.promptMd).toContain('Financial Agent');
    expect(files.name).toBe('financial');
  });

  it('throws on malformed output', () => {
    expect(() => generateAgentFiles('random garbage')).toThrow();
  });
});
