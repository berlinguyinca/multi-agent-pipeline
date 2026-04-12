import type { AdapterType } from './adapter.js';

export interface AgentAssignment {
  adapter: AdapterType;
  model?: string;
}

export interface PipelineConfig {
  agents: {
    spec: AgentAssignment;
    review: AgentAssignment;
    execute: AgentAssignment;
  };
  outputDir: string;
  gitCheckpoints: boolean;
}

export type StageName = 'spec' | 'review' | 'execute';

export const STAGE_NAMES: readonly StageName[] = ['spec', 'review', 'execute'] as const;
