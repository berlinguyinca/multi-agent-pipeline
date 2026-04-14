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
  DocumentationResult,
  QaAssessment,
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
  OllamaConfig,
  QualityConfig,
} from './types/config.js';

export type {
  CheckpointData,
  CheckpointMeta,
} from './types/checkpoint.js';

export type {
  GitHubIssueRef,
  GitHubIssueComment,
  GitHubIssueContext,
  GitHubReportResult,
} from './types/github.js';

export {
  createSpec,
  extractAcceptanceCriteria,
  isValidRefinementScore,
} from './types/spec.js';

export { isActiveStage, isTerminalStage, ACTIVE_STAGES } from './types/pipeline.js';
export { STAGE_NAMES } from './types/config.js';

export type { HeadlessOptions, HeadlessResult } from './types/headless.js';

export { runHeadless } from './headless/runner.js';

export {
  parseGitHubIssueUrl,
  buildGitHubIssuePrompt,
  buildGitHubReport,
} from './github/issues.js';
