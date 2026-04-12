import { randomUUID } from 'node:crypto';
import type { PipelineContext } from '../types/pipeline.js';
import type { AdapterConfig } from '../types/adapter.js';

export interface CreateContextOptions {
  prompt: string;
  agents: {
    spec: AdapterConfig;
    review: AdapterConfig;
    execute: AdapterConfig;
  };
  outputDir?: string;
}

export function createPipelineContext(options: CreateContextOptions): PipelineContext {
  return {
    prompt: options.prompt,
    spec: null,
    reviewedSpec: null,
    iteration: 1,
    refinementScores: [],
    agents: options.agents,
    outputDir: options.outputDir ?? './output',
    feedbackHistory: [],
    pipelineId: randomUUID(),
    startedAt: new Date(),
  };
}
