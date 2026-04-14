import { parse as parseYaml } from 'yaml';

export function buildCreationPrompt(description: string): string {
  return `You are helping create a new agent definition for a multi-agent pipeline system.

The user wants an agent that does: ${description}

Generate two files:

1. An agent.yaml configuration file with fields: name, description, adapter (claude/codex/ollama/hermes), model (optional), prompt: prompt.md, pipeline (list of stage names), handles (comma-separated capabilities), output type (answer/data/files), tools (array, use [] if none).

2. A prompt.md file with a rich system prompt in markdown.

Output the two files separated by markers:

---AGENT_YAML---
<contents of agent.yaml>
---PROMPT_MD---
<contents of prompt.md>

Only output the two files with markers. No other text.`;
}

export interface GeneratedAgentFiles { name: string; agentYaml: string; promptMd: string; }

export function generateAgentFiles(llmOutput: string): GeneratedAgentFiles {
  const yamlMatch = llmOutput.match(/---AGENT_YAML---\s*\n([\s\S]*?)---PROMPT_MD---/);
  const promptMatch = llmOutput.match(/---PROMPT_MD---\s*\n([\s\S]*?)$/);
  if (!yamlMatch || !promptMatch) throw new Error('LLM output does not contain expected ---AGENT_YAML--- and ---PROMPT_MD--- markers');
  const agentYaml = yamlMatch[1].trim();
  const promptMd = promptMatch[1].trim();
  const parsed = parseYaml(agentYaml) as { name?: string };
  if (!parsed.name) throw new Error('Generated agent.yaml is missing "name" field');
  return { name: parsed.name, agentYaml, promptMd };
}
