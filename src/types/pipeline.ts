import type { AdapterConfig } from './adapter.js';
import type {
  Spec,
  ReviewedSpec,
  RefinementScore,
  ExecutionResult,
  DocumentationResult,
  QaAssessment,
} from './spec.js';

export type PipelineStage =
  | 'idle'
  | 'specifying'
  | 'reviewing'
  | 'specAssessing'
  | 'feedback'
  | 'executing'
  | 'codeAssessing'
  | 'fixing'
  | 'documenting'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface PipelineContext {
  prompt: string;
  initialSpec?: string;
  specFilePath?: string;
  spec: Spec | null;
  reviewedSpec: ReviewedSpec | null;
  iteration: number;
  refinementScores: RefinementScore[];
  qaAssessments: QaAssessment[];
  specQaIterations: number;
  codeQaIterations: number;
  agents: {
    spec: AdapterConfig;
    review: AdapterConfig;
    qa: AdapterConfig;
    execute: AdapterConfig;
    docs: AdapterConfig;
  };
  outputDir: string;
  error?: string;
  feedbackHistory: string[];
  personality?: string;
  executionResult?: ExecutionResult;
  documentationResult?: DocumentationResult;
  pipelineId: string;
  startedAt: Date;
}

export type PipelineEvent =
  | { type: 'START'; prompt: string; initialSpec?: Spec; specFilePath?: string }
  | { type: 'SPEC_COMPLETE'; spec: Spec }
  | { type: 'REVIEW_COMPLETE'; reviewedSpec: ReviewedSpec; score: RefinementScore }
  | { type: 'SPEC_QA_COMPLETE'; assessment: QaAssessment; maxReached: boolean }
  | { type: 'APPROVE' }
  | { type: 'FEEDBACK'; text: string }
  | { type: 'EXECUTE_COMPLETE'; result: ExecutionResult }
  | { type: 'CODE_QA_COMPLETE'; assessment: QaAssessment; maxReached: boolean }
  | { type: 'CODE_FIX_COMPLETE'; result: ExecutionResult }
  | { type: 'DOCS_COMPLETE'; result: DocumentationResult }
  | { type: 'CANCEL' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESUME'; pipelineId: string };

export const ACTIVE_STAGES: readonly PipelineStage[] = [
  'specifying',
  'reviewing',
  'specAssessing',
  'executing',
  'codeAssessing',
  'fixing',
  'documenting',
] as const;

export function isActiveStage(stage: PipelineStage): boolean {
  return (ACTIVE_STAGES as readonly string[]).includes(stage);
}

export function isTerminalStage(stage: PipelineStage): boolean {
  return stage === 'complete' || stage === 'failed' || stage === 'cancelled';
}
