import type { PipelineConfig } from '../types/config.js';

export const DEFAULT_CONFIG: PipelineConfig = {
  agents: {
    spec: { adapter: 'claude' },
    review: { adapter: 'codex' },
    qa: { adapter: 'codex' },
    execute: { adapter: 'claude' },
    docs: { adapter: 'claude' },
  },
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
};
