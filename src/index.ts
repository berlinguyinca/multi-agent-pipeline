export type {
  AdapterType,
  AdapterConfig,
  AgentAdapter,
  RunOptions,
  DetectInfo,
  OllamaDetectInfo,
  DetectionResult,
} from './types/adapter.js';

export type {
  Spec,
  ReviewedSpec,
  ReviewAnnotation,
  RefinementScore,
  FeedbackLoop,
  ExecutionResult,
} from './types/spec.js';

export type {
  PipelineStage,
  PipelineContext,
  PipelineEvent,
} from './types/pipeline.js';

export type {
  PipelineConfig,
  AgentAssignment,
  StageName,
} from './types/config.js';

export type {
  CheckpointData,
  CheckpointMeta,
} from './types/checkpoint.js';

export {
  createSpec,
  extractAcceptanceCriteria,
  isValidRefinementScore,
} from './types/spec.js';

export { isActiveStage, isTerminalStage, ACTIVE_STAGES } from './types/pipeline.js';
export { STAGE_NAMES } from './types/config.js';
