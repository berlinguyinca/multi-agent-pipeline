// src/agents/loader.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentDefinition, AgentStageConfig, AgentToolConfig } from '../types/agent-definition.js';
import { isValidAgentDefinition } from '../types/agent-definition.js';

interface RawAgentYaml {
  name: string;
  description: string;
  adapter: string;
  model?: string;
  prompt: string;
  pipeline: Array<string | { name: string; prompt?: string }>;
  handles: string;
  output: { type: string };
  tools: Array<Record<string, unknown>>;
  enabled?: boolean;
  fallbacks?: Array<{ adapter: string; model?: string }>;
  think?: boolean;
}

export async function loadAgentFromDirectory(agentDir: string): Promise<AgentDefinition> {
  const yamlPath = path.join(agentDir, 'agent.yaml');
  const content = await fs.readFile(yamlPath, 'utf-8');
  const raw = parseYaml(content) as RawAgentYaml;

  const mainPrompt = await loadPromptFile(agentDir, raw.prompt);

  const pipeline: AgentStageConfig[] = await Promise.all(
    raw.pipeline.map(async (stage) => {
      if (typeof stage === 'string') {
        return { name: stage };
      }
      const stageConfig: AgentStageConfig = { name: stage.name };
      if (stage.prompt) {
        stageConfig.prompt = await loadPromptFile(agentDir, stage.prompt);
      }
      return stageConfig;
    }),
  );

  const tools: AgentToolConfig[] = (raw.tools ?? []).map((tool) => {
    if (tool['type'] === 'mcp') {
      return { type: 'mcp' as const, uri: tool['uri'] as string };
    }
    return {
      type: 'builtin' as const,
      name: tool['name'] as string,
      ...(tool['config'] ? { config: tool['config'] as Record<string, unknown> } : {}),
    };
  });

  const fallbacks = raw.fallbacks?.map((fb) => ({
    adapter: fb.adapter as AgentDefinition['adapter'],
    model: fb.model,
  }));

  const agent: AgentDefinition = {
    name: raw.name,
    description: raw.description,
    adapter: raw.adapter as AgentDefinition['adapter'],
    model: raw.model,
    prompt: mainPrompt,
    pipeline,
    handles: raw.handles,
    output: { type: raw.output.type as AgentDefinition['output']['type'] },
    tools,
    enabled: raw.enabled,
    ...(fallbacks && fallbacks.length > 0 ? { fallbacks } : {}),
    ...(raw.think !== undefined ? { think: raw.think } : {}),
  };

  if (!isValidAgentDefinition(agent)) {
    throw new Error(`Invalid agent definition in ${yamlPath}`);
  }

  return agent;
}

async function loadPromptFile(baseDir: string, promptPath: string): Promise<string> {
  const fullPath = path.join(baseDir, promptPath);
  return (await fs.readFile(fullPath, 'utf-8')).trim();
}
