import * as fs from 'fs/promises';
import * as path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface AgentFileBundle {
  directory: string;
  yamlPath: string;
  promptPath: string;
  yamlContent: string;
  promptContent: string;
  parsedYaml: Record<string, unknown>;
}

export async function loadAgentFiles(agentsDir: string, agentName: string): Promise<AgentFileBundle> {
  const directory = path.join(agentsDir, agentName);
  const yamlPath = path.join(directory, 'agent.yaml');
  const yamlContent = await fs.readFile(yamlPath, 'utf8');
  const parsedYaml = parseYaml(yamlContent) as Record<string, unknown>;
  const promptRelative = typeof parsedYaml['prompt'] === 'string' ? parsedYaml['prompt'] : 'prompt.md';
  const promptPath = path.join(directory, promptRelative);
  const promptContent = await fs.readFile(promptPath, 'utf8');
  return {
    directory,
    yamlPath,
    promptPath,
    yamlContent,
    promptContent,
    parsedYaml,
  };
}

export async function saveAgentYaml(
  agentsDir: string,
  agentName: string,
  updater: (parsed: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const bundle = await loadAgentFiles(agentsDir, agentName);
  const updated = updater({ ...bundle.parsedYaml });
  await fs.writeFile(bundle.yamlPath, `${stringifyYaml(updated).trimEnd()}\n`, 'utf8');
}

export async function saveAgentPrompt(
  agentsDir: string,
  agentName: string,
  promptContent: string,
): Promise<void> {
  const bundle = await loadAgentFiles(agentsDir, agentName);
  await fs.writeFile(bundle.promptPath, `${promptContent.trimEnd()}\n`, 'utf8');
}
