// src/types/agent-definition.ts
import type { AdapterType } from './adapter.js';

export type OutputType = 'answer' | 'data' | 'files';

export interface AgentOutputConfig {
  type: OutputType;
}

export interface BuiltinToolConfig {
  type: 'builtin';
  name: string;
  config?: Record<string, unknown>;
}

export interface MCPToolConfig {
  type: 'mcp';
  uri: string;
}

export type AgentToolConfig = BuiltinToolConfig | MCPToolConfig;

export interface AgentStageConfig {
  name: string;
  prompt?: string;
}

export interface AdapterFallback {
  adapter: AdapterType;
  model?: string;
}

export interface AgentDefinition {
  name: string;
  description: string;
  adapter: AdapterType;
  model?: string;
  prompt: string;
  pipeline: AgentStageConfig[];
  handles: string;
  output: AgentOutputConfig;
  tools: AgentToolConfig[];
  enabled?: boolean;
  fallbacks?: AdapterFallback[];
}

const VALID_OUTPUT_TYPES: readonly OutputType[] = ['answer', 'data', 'files'];

export function isValidAgentDefinition(agent: AgentDefinition): boolean {
  if (!agent.name || typeof agent.name !== 'string') return false;
  if (!agent.description || typeof agent.description !== 'string') return false;
  if (!agent.prompt || typeof agent.prompt !== 'string') return false;
  if (!agent.handles || typeof agent.handles !== 'string') return false;
  if (!Array.isArray(agent.pipeline) || agent.pipeline.length === 0) return false;
  if (!agent.output || !VALID_OUTPUT_TYPES.includes(agent.output.type)) return false;
  return true;
}
