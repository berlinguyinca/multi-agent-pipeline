import type { AdapterType } from './adapter.js';
import type { SecurityConfig } from '../security/types.js';

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

export interface GitHubConfig {
  token?: string;
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
  stepTimeoutMs: number;
  maxStepRetries: number;
  retryDelayMs: number;
  consensus: RouterConsensusConfig;
}

export interface RouterConsensusConfig {
  enabled: boolean;
  models: string[];
  scope: 'router';
  mode: 'majority';
}

export interface AgentCreationConfig {
  adapter: AdapterType;
  model: string;
}

export interface AdapterRunDefaults {
  think?: boolean;
}

export type AdapterDefaultsMap = Partial<Record<AdapterType, AdapterRunDefaults>>;

export interface PipelineConfig {
  agents: {
    spec: AgentAssignment;
    review: AgentAssignment;
    qa: AgentAssignment;
    execute: AgentAssignment;
    docs: AgentAssignment;
  };
  github: GitHubConfig;
  ollama: OllamaConfig;
  quality: QualityConfig;
  outputDir: string;
  gitCheckpoints: boolean;
  generateAgentSummary: boolean;
  headless: HeadlessRuntimeConfig;
  router: RouterConfig;
  agentCreation: AgentCreationConfig;
  adapterDefaults: AdapterDefaultsMap;
  agentOverrides: Record<string, { adapter?: AdapterType; model?: string; enabled?: boolean }>;
  security: SecurityConfig;
}

export type StageName = 'spec' | 'review' | 'qa' | 'execute' | 'docs';

export const STAGE_NAMES: readonly StageName[] = [
  'spec',
  'review',
  'qa',
  'execute',
  'docs',
] as const;
