import React, { createContext, useContext } from 'react';
import { useActor } from '@xstate/react';
import { pipelineMachine } from '../../pipeline/machine.js';
import type { PipelineContext } from '../../types/pipeline.js';

type PipelineActorReturn = ReturnType<typeof useActor<typeof pipelineMachine>>;

const PipelineContext_ = createContext<PipelineActorReturn | null>(null);

export function usePipelineActor() {
  const ctx = useContext(PipelineContext_);
  if (!ctx) throw new Error('usePipelineActor must be used within PipelineProvider');
  return ctx;
}

interface PipelineProviderProps {
  initialContext: PipelineContext;
  children?: React.ReactNode;
}

export function PipelineProvider({ initialContext, children }: PipelineProviderProps) {
  const actorResult = useActor(pipelineMachine, {
    snapshot: pipelineMachine.resolveState({
      value: 'idle',
      context: initialContext,
    }),
  });

  return React.createElement(
    PipelineContext_.Provider,
    { value: actorResult },
    children,
  );
}
