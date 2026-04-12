import type { PipelineContext } from '../types/pipeline.js';

export function hasSpec(context: PipelineContext): boolean {
  return context.spec !== null;
}

export function hasReviewedSpec(context: PipelineContext): boolean {
  return context.reviewedSpec !== null;
}

export function hasExecutionResult(context: PipelineContext): boolean {
  return context.executionResult !== undefined;
}

export function isExecutionSuccessful(context: PipelineContext): boolean {
  return context.executionResult?.success === true;
}
