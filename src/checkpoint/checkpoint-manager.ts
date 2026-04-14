import type { PipelineContext } from '../types/pipeline.js';
import type { CheckpointMeta } from '../types/checkpoint.js';
import { createCheckpoint, listCheckpoints } from './git-checkpoint.js';

export async function saveCheckpoint(
  context: PipelineContext,
  dir: string
): Promise<CheckpointMeta> {
  const meta: CheckpointMeta = {
    pipelineId: context.pipelineId,
    name: context.prompt.slice(0, 40).replace(/\s+/g, '-'),
    stage: 'idle',
    iteration: context.iteration,
    agents: {
      spec: { adapter: context.agents.spec.type },
      review: { adapter: context.agents.review.type },
      qa: { adapter: context.agents.qa.type },
      execute: { adapter: context.agents.execute.type },
      docs: { adapter: context.agents.docs.type },
    },
    timestamp: new Date(),
    commitHash: '',
  };

  const stateJson = JSON.stringify({
    pipelineId: context.pipelineId,
    prompt: context.prompt,
    iteration: context.iteration,
    outputDir: context.outputDir,
    startedAt: context.startedAt,
  });

  const commitHash = await createCheckpoint(dir, meta, stateJson);

  return { ...meta, commitHash };
}

export async function listSavedPipelines(dir: string): Promise<CheckpointMeta[]> {
  return listCheckpoints(dir);
}
