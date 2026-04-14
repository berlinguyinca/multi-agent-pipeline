import type { AdapterType } from '../types/adapter.js';
import type { PipelineConfig } from '../types/config.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/types.js';

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
  headless: {
    totalTimeoutMs: 60 * 60 * 1000,
    inactivityTimeoutMs: 10 * 60 * 1000,
    pollIntervalMs: 10 * 1000,
  },
  router: {
    adapter: 'ollama' as AdapterType,
    model: 'gemma4',
    maxSteps: 10,
    timeoutMs: 30_000,
  },
  agentCreation: {
    adapter: 'ollama' as AdapterType,
    model: 'gemma4',
  },
  agentOverrides: {},
  security: DEFAULT_SECURITY_CONFIG,
};
