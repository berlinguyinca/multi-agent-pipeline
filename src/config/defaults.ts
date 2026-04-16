import type { AdapterType } from '../types/adapter.js';
import type { AgentConsensusConfig, PipelineConfig, RouterConsensusConfig } from '../types/config.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/types.js';

export const DEFAULT_ROUTER_CONSENSUS_CONFIG: RouterConsensusConfig = {
  enabled: true,
  models: [],
  scope: 'router',
  mode: 'majority',
};

export const DEFAULT_AGENT_CONSENSUS_CONFIG: AgentConsensusConfig = {
  enabled: true,
  runs: 3,
  outputTypes: ['answer', 'data', 'presentation'],
  minSimilarity: 0.35,
  fileOutputs: {
    enabled: false,
    runs: 3,
    isolation: 'git-worktree',
    keepWorktreesOnFailure: true,
    verificationCommands: [],
    selection: 'best-passing-minimal-diff',
  },
};

export const DEFAULT_CONFIG: PipelineConfig = {
  agents: {
    spec: { adapter: 'claude' },
    review: { adapter: 'codex' },
    qa: { adapter: 'codex' },
    execute: { adapter: 'claude' },
    docs: { adapter: 'claude' },
  },
  github: {},
  ollama: {
    host: 'http://localhost:11434',
  },
  quality: {
    maxSpecQaIterations: 3,
    maxCodeQaIterations: 3,
  },
  outputDir: './output',
  gitCheckpoints: true,
  generateAgentSummary: true,
  headless: {
    totalTimeoutMs: 60 * 60 * 1000,
    inactivityTimeoutMs: 10 * 60 * 1000,
    pollIntervalMs: 10 * 1000,
  },
  router: {
    adapter: 'ollama' as AdapterType,
    model: 'gemma4',
    maxSteps: 24,
    timeoutMs: 300_000,
    stepTimeoutMs: 5 * 60 * 1000,
    maxStepRetries: 4,
    retryDelayMs: 3_000,
    consensus: DEFAULT_ROUTER_CONSENSUS_CONFIG,
  },
  agentCreation: {
    adapter: 'ollama' as AdapterType,
    model: 'gemma4',
  },
  adapterDefaults: {
    ollama: { think: false, temperature: 0, seed: 42 },
  },
  agentConsensus: DEFAULT_AGENT_CONSENSUS_CONFIG,
  agentOverrides: {},
  security: DEFAULT_SECURITY_CONFIG,
};
