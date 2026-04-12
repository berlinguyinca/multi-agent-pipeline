import type { PipelineStage } from './pipeline.js';
import type { AgentAssignment } from './config.js';

export interface CheckpointData {
  pipelineId: string;
  stage: PipelineStage;
  context: Record<string, unknown>;
  timestamp: Date;
  commitHash: string;
}

export interface CheckpointMeta {
  pipelineId: string;
  name: string;
  stage: PipelineStage;
  iteration: number;
  agents: Record<string, AgentAssignment>;
  timestamp: Date;
  commitHash: string;
}
