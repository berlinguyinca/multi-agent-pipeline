// src/agents/registry.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentDefinition, AgentToolConfig } from '../types/agent-definition.js';
import { loadAgentFromDirectory } from './loader.js';

export interface AgentOverrides {
  adapter?: AgentDefinition['adapter'];
  model?: string;
  enabled?: boolean;
  tools?: AgentToolConfig[];
}

export async function loadAgentRegistry(
  agentsDir: string,
): Promise<Map<string, AgentDefinition>> {
  const agents = new Map<string, AgentDefinition>();

  let entries: string[];
  try {
    entries = await fs.readdir(agentsDir);
  } catch {
    return agents;
  }

  for (const entry of entries) {
    const entryPath = path.join(agentsDir, entry);
    const stat = await fs.stat(entryPath);
    if (!stat.isDirectory()) continue;

    const yamlPath = path.join(entryPath, 'agent.yaml');
    try {
      await fs.access(yamlPath);
    } catch {
      continue;
    }

    const agent = await loadAgentFromDirectory(entryPath);
    agents.set(agent.name, agent);
  }

  return agents;
}

export function mergeWithOverrides(
  base: AgentDefinition,
  overrides: AgentOverrides,
): AgentDefinition {
  const merged = { ...base };

  if (overrides.adapter !== undefined) merged.adapter = overrides.adapter;
  if (overrides.model !== undefined) merged.model = overrides.model;
  if (overrides.enabled !== undefined) merged.enabled = overrides.enabled;

  if (overrides.tools !== undefined) {
    const toolMap = new Map<string, AgentToolConfig>();

    for (const tool of base.tools) {
      const key = toolKey(tool);
      toolMap.set(key, tool);
    }

    for (const tool of overrides.tools) {
      const key = toolKey(tool);
      toolMap.set(key, tool);
    }

    merged.tools = [...toolMap.values()];
  }

  return merged;
}

function toolKey(tool: AgentToolConfig): string {
  if (tool.type === 'mcp') return `mcp:${tool.uri}`;
  return `builtin:${tool.name}`;
}

export function getEnabledAgents(
  agents: Map<string, AgentDefinition>,
): Map<string, AgentDefinition> {
  const enabled = new Map<string, AgentDefinition>();
  for (const [name, agent] of agents) {
    if (agent.enabled !== false) {
      enabled.set(name, agent);
    }
  }
  return enabled;
}
