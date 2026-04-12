import type { AdapterConfig } from './adapter.js';
import type { Spec, ReviewedSpec, RefinementScore, ExecutionResult } from './spec.js';

export type PipelineStage =
  | 'idle'
  | 'specifying'
  | 'reviewing'
  | 'feedback'
  | 'executing'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface PipelineContext {
  prompt: string;
  spec: Spec | null;
  reviewedSpec: ReviewedSpec | null;
  iteration: number;
  refinementScores: RefinementScore[];
  agents: {
    spec: AdapterConfig;
    review: AdapterConfig;
    execute: AdapterConfig;
  };
  outputDir: string;
  error?: string;
  feedbackHistory: string[];
  executionResult?: ExecutionResult;
  pipelineId: string;
  startedAt: Date;
}

export type PipelineEvent =
  | { type: 'START'; prompt: string }
  | { type: 'SPEC_COMPLETE'; spec: Spec }
  | { type: 'REVIEW_COMPLETE'; reviewedSpec: ReviewedSpec; score: RefinementScore }
  | { type: 'APPROVE' }
  | { type: 'FEEDBACK'; text: string }
  | { type: 'EXECUTE_COMPLETE'; result: ExecutionResult }
  | { type: 'CANCEL' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESUME'; pipelineId: string };

export const ACTIVE_STAGES: readonly PipelineStage[] = [
  'specifying',
  'reviewing',
  'executing',
] as const;

export function isActiveStage(stage: PipelineStage): boolean {
  return (ACTIVE_STAGES as readonly string[]).includes(stage);
}

export function isTerminalStage(stage: PipelineStage): boolean {
  return stage === 'complete' || stage === 'failed' || stage === 'cancelled';
}
