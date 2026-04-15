import { randomUUID } from 'node:crypto';
import type { PipelineContext } from '../types/pipeline.js';
import type { AdapterConfig } from '../types/adapter.js';

export interface CreateContextOptions {
  prompt: string;
  initialSpec?: string;
  specFilePath?: string;
  agents: {
    spec: AdapterConfig;
    review: AdapterConfig;
    qa: AdapterConfig;
    execute: AdapterConfig;
    docs: AdapterConfig;
  };
  outputDir?: string;
  personality?: string;
}

export function createPipelineContext(options: CreateContextOptions): PipelineContext {
  return {
    prompt: options.prompt,
    initialSpec: options.initialSpec,
    specFilePath: options.specFilePath,
    spec: null,
    reviewedSpec: null,
    iteration: 1,
    refinementScores: [],
    qaAssessments: [],
    specQaIterations: 0,
    codeQaIterations: 0,
    agents: options.agents,
    outputDir: options.outputDir ?? './output',
    feedbackHistory: [],
    personality: options.personality,
    pipelineId: randomUUID(),
    startedAt: new Date(),
  };
}
