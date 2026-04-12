import { setup, assign, createActor, type ActorRefFrom } from 'xstate';
import type { PipelineContext, PipelineEvent } from '../types/pipeline.js';
import type { Spec, ReviewedSpec, RefinementScore, ExecutionResult } from '../types/spec.js';
import { createPipelineContext } from './context.js';

export const pipelineMachine = setup({
  types: {
    context: {} as PipelineContext,
    events: {} as PipelineEvent,
  },
  guards: {
    hasSpec: ({ context }) => context.spec !== null,
    hasReviewedSpec: ({ context }) => context.reviewedSpec !== null,
  },
}).createMachine({
  id: 'pipeline',
  initial: 'idle',
  context: () =>
    createPipelineContext({
      prompt: '',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        execute: { type: 'claude' },
      },
    }),
  states: {
    idle: {
      on: {
        START: {
          target: 'specifying',
          actions: assign({
            prompt: ({ event }) => event.prompt,
          }),
        },
        RESUME: {
          target: 'feedback',
        },
      },
    },
    specifying: {
      on: {
        SPEC_COMPLETE: {
          target: 'reviewing',
          actions: assign({
            spec: ({ event }) => event.spec,
          }),
        },
        ERROR: {
          target: 'failed',
          actions: assign({
            error: ({ event }) => event.error,
          }),
        },
        CANCEL: {
          target: 'cancelled',
        },
      },
    },
    reviewing: {
      on: {
        REVIEW_COMPLETE: {
          target: 'feedback',
          actions: assign({
            reviewedSpec: ({ event }) => event.reviewedSpec,
            refinementScores: ({ context, event }) => [
              ...context.refinementScores,
              event.score,
            ],
          }),
        },
        ERROR: {
          target: 'failed',
          actions: assign({
            error: ({ event }) => event.error,
          }),
        },
        CANCEL: {
          target: 'cancelled',
        },
      },
    },
    feedback: {
      on: {
        APPROVE: {
          target: 'executing',
        },
        FEEDBACK: {
          target: 'specifying',
          actions: assign({
            feedbackHistory: ({ context, event }) => [
              ...context.feedbackHistory,
              event.text,
            ],
            iteration: ({ context }) => context.iteration + 1,
            spec: () => null,
            reviewedSpec: () => null,
          }),
        },
        CANCEL: {
          target: 'cancelled',
        },
      },
    },
    executing: {
      on: {
        EXECUTE_COMPLETE: {
          target: 'complete',
          actions: assign({
            executionResult: ({ event }) => event.result,
          }),
        },
        ERROR: {
          target: 'failed',
          actions: assign({
            error: ({ event }) => event.error,
          }),
        },
        CANCEL: {
          target: 'cancelled',
        },
      },
    },
    complete: {
      type: 'final',
    },
    failed: {
      on: {
        FEEDBACK: {
          target: 'specifying',
          actions: assign({
            feedbackHistory: ({ context, event }) => [
              ...context.feedbackHistory,
              event.text,
            ],
            iteration: ({ context }) => context.iteration + 1,
            spec: () => null,
            reviewedSpec: () => null,
            error: () => undefined,
          }),
        },
      },
    },
    cancelled: {
      type: 'final',
    },
  },
});

export type PipelineMachine = typeof pipelineMachine;
export type PipelineActor = ActorRefFrom<typeof pipelineMachine>;

export function createPipelineActor(context?: PipelineContext) {
  if (context) {
    const snapshot = pipelineMachine.resolveState({
      value: 'idle',
      context,
    });
    return createActor(pipelineMachine, { snapshot });
  }
  return createActor(pipelineMachine, {});
}
