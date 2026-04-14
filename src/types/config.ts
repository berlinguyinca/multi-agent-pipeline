import type { AdapterType } from './adapter.js';

export interface AdapterFallback {
  adapter: AdapterType;
  model?: string;
}

export interface AgentAssignment {
  adapter: AdapterType;
  model?: string;
  fallbacks?: AdapterFallback[];
}

export interface HeadlessRuntimeConfig {
  totalTimeoutMs: number;
  inactivityTimeoutMs: number;
  pollIntervalMs: number;
}

export interface OllamaConfig {
  host: string;
}

export interface QualityConfig {
  maxSpecQaIterations: number;
  maxCodeQaIterations: number;
}

export interface RouterConfig {
  adapter: AdapterType;
  model: string;
  maxSteps: number;
  timeoutMs: number;
}

export interface AgentCreationConfig {
  adapter: AdapterType;
  model: string;
}

export interface PipelineConfig {
  agents: {
    spec: AgentAssignment;
    review: AgentAssignment;
    qa: AgentAssignment;
    execute: AgentAssignment;
    docs: AgentAssignment;
  };
  ollama: OllamaConfig;
  quality: QualityConfig;
  outputDir: string;
  gitCheckpoints: boolean;
  headless: HeadlessRuntimeConfig;
  router: RouterConfig;
  agentCreation: AgentCreationConfig;
  agentOverrides: Record<string, { adapter?: AdapterType; model?: string; enabled?: boolean }>;
}

export type StageName = 'spec' | 'review' | 'qa' | 'execute' | 'docs';

export const STAGE_NAMES: readonly StageName[] = [
  'spec',
  'review',
  'qa',
  'execute',
  'docs',
] as const;
