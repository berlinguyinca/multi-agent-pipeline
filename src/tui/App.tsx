import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PipelineProvider, usePipelineActor } from './providers/PipelineProvider.js';
import { ConfigProvider } from './providers/ConfigProvider.js';
import WelcomeScreen from './screens/WelcomeScreen.js';
import PipelineScreen from './screens/PipelineScreen.js';
import FeedbackScreen from './screens/FeedbackScreen.js';
import ExecuteScreen from './screens/ExecuteScreen.js';
import CompleteScreen from './screens/CompleteScreen.js';
import type { PipelineConfig, AgentAssignment, StageName } from '../types/config.js';
import type { DetectionResult } from '../types/adapter.js';
import { createPipelineContext } from '../pipeline/context.js';

interface AppProps {
  initialPrompt?: string;
  config: PipelineConfig;
  detection: DetectionResult;
}

function AppRouter({ initialPrompt, config, detection }: AppProps) {
  const [snapshot, send] = usePipelineActor();
  const [agents, setAgents] = useState<Record<StageName, AgentAssignment>>({
    spec: config.agents.spec,
    review: config.agents.review,
    execute: config.agents.execute,
  });

  const stateValue = typeof snapshot.value === 'string' ? snapshot.value : 'idle';
  const context = snapshot.context;

  function handleStart(prompt: string) {
    send({ type: 'START', prompt });
  }

  function handleResume() {
    send({ type: 'RESUME', pipelineId: '' });
  }

  function handleAssign(stage: string, agent: string) {
    setAgents((prev) => ({
      ...prev,
      [stage as StageName]: { adapter: agent as AgentAssignment['adapter'] },
    }));
  }

  function handleApprove() {
    send({ type: 'APPROVE' });
  }

  function handleFeedback(text: string) {
    send({ type: 'FEEDBACK', text });
  }

  const baseStages = [
    {
      name: 'Spec',
      status: 'waiting' as const,
      agent: agents.spec.adapter,
    },
    {
      name: 'Review',
      status: 'waiting' as const,
      agent: agents.review.adapter,
    },
    {
      name: 'Execute',
      status: 'waiting' as const,
      agent: agents.execute.adapter,
    },
  ];

  if (stateValue === 'idle') {
    return React.createElement(WelcomeScreen, {
      onStart: handleStart,
      onResume: handleResume,
      detection,
      agents,
      onAssign: handleAssign,
    });
  }

  if (stateValue === 'specifying' || stateValue === 'reviewing') {
    const stageName = stateValue === 'specifying' ? 'Spec' : 'Review';
    const agentKey: StageName = stateValue === 'specifying' ? 'spec' : 'review';
    const stages = baseStages.map((s) => ({
      ...s,
      status:
        s.name === stageName
          ? ('active' as const)
          : baseStages.indexOf(s) < baseStages.findIndex((bs) => bs.name === stageName)
            ? ('complete' as const)
            : ('waiting' as const),
    }));

    return React.createElement(PipelineScreen, {
      stages,
      iteration: context.iteration,
      output: '',
      streaming: true,
      stageName,
      agentName: agents[agentKey].adapter,
    });
  }

  if (stateValue === 'feedback') {
    const stages = baseStages.map((s, i) => ({
      ...s,
      status: i < 2 ? ('complete' as const) : ('waiting' as const),
    }));

    const specContent = context.reviewedSpec?.content ?? context.spec?.content ?? '';
    const scores = context.refinementScores.map((rs) => ({
      iteration: rs.iteration,
      score: rs.score,
    }));

    return React.createElement(FeedbackScreen, {
      stages,
      iteration: context.iteration,
      scores,
      specContent,
      previousSpecContent: undefined,
      onApprove: handleApprove,
      onFeedback: handleFeedback,
    });
  }

  if (stateValue === 'executing') {
    const stages = baseStages.map((s, i) => ({
      ...s,
      status:
        i < 2
          ? ('complete' as const)
          : i === 2
            ? ('active' as const)
            : ('waiting' as const),
    }));

    return React.createElement(ExecuteScreen, {
      stages,
      iteration: context.iteration,
      output: '',
      streaming: true,
      tests: [],
    });
  }

  if (stateValue === 'complete') {
    const result = context.executionResult;
    return React.createElement(CompleteScreen, {
      iterations: context.iteration,
      testsTotal: result?.testsTotal ?? 0,
      testsPassing: result?.testsPassing ?? 0,
      filesCreated: result?.filesCreated ?? [],
      duration: result?.duration ?? 0,
      outputDir: result?.outputDir ?? context.outputDir,
      onNewPipeline: () => {},
    });
  }

  // failed / cancelled / unknown
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Text, { color: 'red' }, `Pipeline state: ${stateValue}`),
    context.error
      ? React.createElement(Text, { dimColor: true }, context.error)
      : null,
  );
}

export default function App({ initialPrompt, config, detection }: AppProps) {
  const initialContext = createPipelineContext({
    prompt: initialPrompt ?? '',
    agents: {
      spec: { type: config.agents.spec.adapter },
      review: { type: config.agents.review.adapter },
      execute: { type: config.agents.execute.adapter },
    },
  });

  return React.createElement(
    ConfigProvider,
    { config, detection },
    React.createElement(
      PipelineProvider,
      { initialContext },
      React.createElement(AppRouter, { initialPrompt, config, detection }),
    ),
  );
}
