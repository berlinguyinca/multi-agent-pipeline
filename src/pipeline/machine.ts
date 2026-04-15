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
    qaPassed: ({ event }) =>
      (event.type === 'SPEC_QA_COMPLETE' || event.type === 'CODE_QA_COMPLETE') &&
      event.assessment.passed,
    qaMaxReached: ({ event }) =>
      (event.type === 'SPEC_QA_COMPLETE' || event.type === 'CODE_QA_COMPLETE') &&
      event.maxReached,
    executionPassed: ({ event }) => event.type === 'EXECUTE_COMPLETE' && event.result.success,
    fixPassed: ({ event }) => event.type === 'CODE_FIX_COMPLETE' && event.result.success,
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
        qa: { type: 'codex' },
        execute: { type: 'claude' },
        docs: { type: 'claude' },
      },
    }),
  states: {
    idle: {
      on: {
        START: [
          {
            guard: ({ event }) => event.type === 'START' && event.initialSpec !== undefined,
            target: 'reviewing',
            actions: assign({
              prompt: ({ event }) => event.prompt,
              initialSpec: ({ event }) => event.initialSpec?.content,
              specFilePath: ({ event }) => event.specFilePath,
              spec: ({ event }) => event.initialSpec ?? null,
            }),
          },
          {
            target: 'specifying',
            actions: assign({
              prompt: ({ event }) => event.prompt,
              initialSpec: () => undefined,
              specFilePath: ({ event }) => event.specFilePath,
            }),
          },
        ],
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
          target: 'specAssessing',
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
    specAssessing: {
      on: {
        SPEC_QA_COMPLETE: [
          {
            guard: 'qaPassed',
            target: 'feedback',
            actions: assign({
              qaAssessments: ({ context, event }) => [
                ...context.qaAssessments,
                event.assessment,
              ],
              specQaIterations: ({ context }) => context.specQaIterations + 1,
            }),
          },
          {
            guard: 'qaMaxReached',
            target: 'failed',
            actions: assign({
              qaAssessments: ({ context, event }) => [
                ...context.qaAssessments,
                event.assessment,
              ],
              specQaIterations: ({ context }) => context.specQaIterations + 1,
              error: ({ context }) =>
                `Spec QA failed after ${context.specQaIterations + 1} iteration${
                  context.specQaIterations + 1 === 1 ? '' : 's'
                }`,
            }),
          },
          {
            target: 'specifying',
            actions: assign({
              qaAssessments: ({ context, event }) => [
                ...context.qaAssessments,
                event.assessment,
              ],
              specQaIterations: ({ context }) => context.specQaIterations + 1,
              feedbackHistory: ({ context, event }) => [
                ...context.feedbackHistory,
                event.assessment.requiredChanges.join('\n') ||
                  event.assessment.summary ||
                  'Address QA findings before implementation.',
              ],
              iteration: ({ context }) => context.iteration + 1,
              spec: () => null,
              reviewedSpec: () => null,
            }),
          },
        ],
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
            specQaIterations: () => 0,
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
        EXECUTE_COMPLETE: [
          {
            guard: 'executionPassed',
            target: 'codeAssessing',
            actions: assign({
              executionResult: ({ event }) => event.result,
            }),
          },
          {
            target: 'failed',
            actions: assign({
              executionResult: ({ event }) => event.result,
              error: () => 'Execution completed with failing tests',
            }),
          },
        ],
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
    codeAssessing: {
      on: {
        CODE_QA_COMPLETE: [
          {
            guard: 'qaPassed',
            target: 'documenting',
            actions: assign({
              qaAssessments: ({ context, event }) => [
                ...context.qaAssessments,
                event.assessment,
              ],
              codeQaIterations: ({ context }) => context.codeQaIterations + 1,
            }),
          },
          {
            guard: 'qaMaxReached',
            target: 'failed',
            actions: assign({
              qaAssessments: ({ context, event }) => [
                ...context.qaAssessments,
                event.assessment,
              ],
              codeQaIterations: ({ context }) => context.codeQaIterations + 1,
              error: ({ context }) =>
                `Code QA failed after ${context.codeQaIterations + 1} iteration${
                  context.codeQaIterations + 1 === 1 ? '' : 's'
                }`,
            }),
          },
          {
            target: 'fixing',
            actions: assign({
              qaAssessments: ({ context, event }) => [
                ...context.qaAssessments,
                event.assessment,
              ],
              codeQaIterations: ({ context }) => context.codeQaIterations + 1,
            }),
          },
        ],
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
    fixing: {
      on: {
        CODE_FIX_COMPLETE: [
          {
            guard: 'fixPassed',
            target: 'codeAssessing',
            actions: assign({
              executionResult: ({ event }) => event.result,
            }),
          },
          {
            target: 'failed',
            actions: assign({
              executionResult: ({ event }) => event.result,
              error: () => 'Execution fix completed with failing tests',
            }),
          },
        ],
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
    documenting: {
      on: {
        DOCS_COMPLETE: {
          target: 'complete',
          actions: assign({
            documentationResult: ({ event }) => event.result,
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
            specQaIterations: () => 0,
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
