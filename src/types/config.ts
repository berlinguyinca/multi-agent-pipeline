import type { AdapterType } from './adapter.js';
import type { AgentDefinition } from './agent-definition.js';
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
  contextLength: number;
  numParallel: number;
  maxLoadedModels: number;
}

export interface QualityConfig {
  maxSpecQaIterations: number;
  maxCodeQaIterations: number;
}

export interface EvidenceConfig {
  enabled: boolean;
  mode: 'strict' | 'warn' | 'off' | 'high-stakes';
  requiredAgents: string[];
  currentClaimMaxSourceAgeDays: number;
  freshnessProfiles: Record<string, number>;
  requireRetrievedAtForWebClaims: boolean;
  blockUnsupportedCurrentClaims: boolean;
  remediationMaxRetries: number;
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
  temperature?: number;
  seed?: number;
}

export type AdapterDefaultsMap = Partial<Record<AdapterType, AdapterRunDefaults>>;

export interface AgentConsensusConfig {
  enabled: boolean;
  runs: number;
  outputTypes: Array<AgentDefinition['output']['type']>;
  minSimilarity: number;
  perAgent: Record<string, AgentConsensusOverride>;
  fileOutputs: FileOutputConsensusConfig;
}

export interface AgentConsensusOverride {
  enabled?: boolean;
  runs?: number;
  outputTypes?: Array<AgentDefinition['output']['type']>;
  minSimilarity?: number;
}

export interface FileOutputConsensusConfig {
  enabled: boolean;
  runs: number;
  isolation: 'git-worktree';
  keepWorktreesOnFailure: boolean;
  verificationCommands: string[];
  selection: 'best-passing-minimal-diff';
}

export type CrossReviewGateKey =
  | 'planning'
  | 'routing'
  | 'architecture'
  | 'apiContract'
  | 'fileOutputs'
  | 'security'
  | 'releaseReadiness'
  | 'verificationFailure';

export interface CrossReviewJudgeConfig {
  preferSeparatePanel: boolean;
  models: string[];
  roles: string[];
}

export interface CrossReviewRoleModelConfig {
  proposer?: string;
  reviewer?: string;
}

export interface CrossReviewConfig {
  enabled: boolean;
  defaultHighImpactOnly: boolean;
  maxRounds: number;
  maxRoundsUpperBound: number;
  autonomy: 'nonblocking';
  judge: CrossReviewJudgeConfig;
  gates: Record<CrossReviewGateKey, boolean>;
  roleModels: Record<string, CrossReviewRoleModelConfig>;
}

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
  evidence: EvidenceConfig;
  outputDir: string;
  workspaceDir?: string;
  gitCheckpoints: boolean;
  generateAgentSummary: boolean;
  headless: HeadlessRuntimeConfig;
  router: RouterConfig;
  agentCreation: AgentCreationConfig;
  adapterDefaults: AdapterDefaultsMap;
  agentConsensus: AgentConsensusConfig;
  crossReview: CrossReviewConfig;
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
