import type { PipelineConfig } from '../types/config.js';

export const DEFAULT_CONFIG: PipelineConfig = {
  agents: {
    spec: { adapter: 'claude' },
    review: { adapter: 'codex' },
    execute: { adapter: 'claude' },
  },
  outputDir: './output',
  gitCheckpoints: true,
};
