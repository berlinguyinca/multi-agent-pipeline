import type { CheckpointMeta } from '../types/checkpoint.js';
import type { PipelineStage } from '../types/pipeline.js';

// Format: [MAP] stage:<stage> iter:<n> id:<pipelineId> name:<name> ts:<iso>
const MAP_PREFIX = '[MAP]';
const MESSAGE_REGEX =
  /^\[MAP\] stage:(\S+) iter:(\d+) id:(\S+) name:(\S+) ts:(\S+)$/;

export function formatCheckpointMessage(meta: CheckpointMeta): string {
  return (
    `${MAP_PREFIX} stage:${meta.stage} iter:${meta.iteration}` +
    ` id:${meta.pipelineId} name:${meta.name} ts:${meta.timestamp.toISOString()}`
  );
}

export function parseCheckpointMessage(message: string): CheckpointMeta | null {
  const match = MESSAGE_REGEX.exec(message.trim());
  if (match === null) {
    return null;
  }

  const [, stage, iterStr, pipelineId, name, tsStr] = match;

  const iteration = parseInt(iterStr!, 10);
  const timestamp = new Date(tsStr!);

  if (isNaN(timestamp.getTime())) {
    return null;
  }

  return {
    pipelineId: pipelineId!,
    name: name!,
    stage: stage as PipelineStage,
    iteration,
    agents: {},
    timestamp,
    commitHash: '',
  };
}
