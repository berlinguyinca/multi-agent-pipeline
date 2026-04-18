import type { AdapterType } from '../types/adapter.js';
import type { AgentConsensusConfig, EvidenceConfig, PipelineConfig, RouterConsensusConfig } from '../types/config.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/types.js';
import {
  DEFAULT_OLLAMA_CONTEXT_LENGTH,
  DEFAULT_OLLAMA_MAX_LOADED_MODELS,
  DEFAULT_OLLAMA_NUM_PARALLEL,
} from './ollama-defaults.js';

export const DEFAULT_ROUTER_CONSENSUS_CONFIG: RouterConsensusConfig = {
  enabled: true,
  models: [],
  scope: 'router',
  mode: 'majority',
};

export const DEFAULT_AGENT_CONSENSUS_CONFIG: AgentConsensusConfig = {
  enabled: false,
  runs: 3,
  outputTypes: ['answer', 'data', 'presentation'],
  minSimilarity: 0.35,
  perAgent: {
    researcher: { enabled: true, runs: 3, outputTypes: ['answer'], minSimilarity: 0.35 },
    'classyfire-taxonomy-classifier': { enabled: true, runs: 3, outputTypes: ['answer'], minSimilarity: 0.35 },
    'usage-classification-tree': { enabled: true, runs: 3, outputTypes: ['answer'], minSimilarity: 0.35 },
  },
  fileOutputs: {
    enabled: false,
    runs: 3,
    isolation: 'git-worktree',
    keepWorktreesOnFailure: true,
    verificationCommands: [],
    selection: 'best-passing-minimal-diff',
  },
};

export const DEFAULT_EVIDENCE_CONFIG: EvidenceConfig = {
  enabled: true,
  mode: 'strict',
  requiredAgents: [
    'usage-classification-tree',
    'researcher',
    'classyfire-taxonomy-classifier',
    'security-advisor',
    'release-readiness-reviewer',
  ],
  currentClaimMaxSourceAgeDays: 730,
  freshnessProfiles: {
    'usage-commonness': 730,
    software: 180,
    medical: 365,
    'chemical-taxonomy': 3650,
  },
  requireRetrievedAtForWebClaims: true,
  blockUnsupportedCurrentClaims: true,
  remediationMaxRetries: 1,
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
    contextLength: DEFAULT_OLLAMA_CONTEXT_LENGTH,
    numParallel: DEFAULT_OLLAMA_NUM_PARALLEL,
    maxLoadedModels: DEFAULT_OLLAMA_MAX_LOADED_MODELS,
  },
  quality: {
    maxSpecQaIterations: 3,
    maxCodeQaIterations: 3,
  },
  evidence: DEFAULT_EVIDENCE_CONFIG,
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
    maxStepRetries: 1,
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
  agentOverrides: {
    'output-formatter': { enabled: false },
  },
  security: DEFAULT_SECURITY_CONFIG,
};
