import { parse as parseYaml } from 'yaml';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createAdapter } from '../adapters/adapter-factory.js';
import { AGENT_CONDUCT_PROMPT } from '../utils/agent-conduct.js';

export interface AgentCreationPreferences {
  name?: string;
  adapter?: string;
  model?: string;
  tools?: string;
  pipeline?: string;
  outputType?: string;
}

export function buildCreationPrompt(description: string, preferences: AgentCreationPreferences = {}): string {
  return `You are helping create a new agent definition for a multi-agent pipeline system.

The user wants an agent that does: ${description}

User preferences:
- name: ${preferences.name || '(choose a short kebab-case name)'}
- adapter: ${preferences.adapter || '(choose from claude/codex/ollama/hermes)'}
- model: ${preferences.model || '(omit unless needed)'}
- tools: ${preferences.tools || '[]'}
- pipeline stages: ${preferences.pipeline || '(choose a concise stage list)'}
- output type: ${preferences.outputType || '(answer/data/files)'}

Generate two files:

1. An agent.yaml configuration file with fields: name, description, adapter (claude/codex/ollama/hermes), model (optional), prompt: prompt.md, pipeline (list of stage names), handles (comma-separated capabilities), output type (answer/data/files), tools (array, use [] if none).

2. A prompt.md file with a rich system prompt in markdown. The prompt must include this conduct section exactly:

${AGENT_CONDUCT_PROMPT}

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

export async function generateAndWriteAgentFiles(options: {
  cwd: string;
  description: string;
  adapter: string;
  model?: string;
  preferences?: AgentCreationPreferences;
}): Promise<GeneratedAgentFiles & { directory: string }> {
  const creationAdapter = createAdapter({ type: options.adapter as any, model: options.model });
  const prompt = buildCreationPrompt(options.description, options.preferences);

  let output = '';
  for await (const chunk of creationAdapter.run(prompt)) {
    output += chunk;
  }

  const files = generateAgentFiles(output);
  const directory = path.join(options.cwd, 'agents', files.name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'agent.yaml'), `${files.agentYaml}\n`, 'utf8');
  await fs.writeFile(path.join(directory, 'prompt.md'), `${files.promptMd}\n`, 'utf8');
  return { ...files, directory };
}
