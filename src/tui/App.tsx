import React, { useEffect, useRef, useState } from 'react';
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
import type { GitHubIssueContext, GitHubReportResult } from '../types/github.js';
import type { HeadlessResult } from '../types/headless.js';
import { createPipelineContext } from '../pipeline/context.js';
import { createSpec } from '../types/spec.js';
import { createAdapter } from '../adapters/adapter-factory.js';
import {
  assertAdapterInstalled,
  assignmentToAdapterConfig,
  buildStagePrompt,
  captureDocumentationBaseline,
  collectProjectSnapshot,
  finalizeDocumentationResult,
  finalizeExecutionResult,
  parseQaOutput,
  parseExecutionProgress,
  parseReviewOutput,
  prepareExecutionOutputDir,
  prepareStageWorkspace,
  type TestProgressItem,
} from './runtime.js';
import {
  buildCodeFixPrompt,
  buildCodeQaPrompt,
  buildSpecQaPrompt,
} from '../prompts/qa-system.js';
import { buildDocsPrompt } from '../prompts/docs-system.js';
import {
  buildGitHubIssuePrompt,
  buildGitHubReport,
  fetchGitHubIssueContext,
  getGitHubToken,
  parseGitHubIssueUrl,
  postGitHubIssueComment,
} from '../github/issues.js';

interface AppProps {
  initialPrompt?: string;
  initialGithubIssueUrl?: string;
  config: PipelineConfig;
  detection: DetectionResult;
}

function AppRouter({ initialPrompt, initialGithubIssueUrl, config, detection }: AppProps) {
  const [snapshot, send] = usePipelineActor();
  const [agents, setAgents] = useState<Record<StageName, AgentAssignment>>({
    spec: config.agents.spec,
    review: config.agents.review,
    qa: config.agents.qa,
    execute: config.agents.execute,
    docs: config.agents.docs,
  });
  const [stageOutput, setStageOutput] = useState('');
  const [executeTests, setExecuteTests] = useState<TestProgressItem[]>([]);
  const [previousSpecContent, setPreviousSpecContent] = useState<string | undefined>(undefined);
  const [githubIssueError, setGithubIssueError] = useState<string | undefined>(undefined);
  const [githubReport, setGithubReport] = useState<GitHubReportResult | undefined>(undefined);
  const autoStartedRef = useRef(false);
  const activeRunKeyRef = useRef<string | null>(null);
  const reportedRunKeyRef = useRef<string | null>(null);
  const githubIssueContextRef = useRef<GitHubIssueContext | undefined>(undefined);
  const githubTokenRef = useRef<string | undefined>(undefined);
  const specContentRef = useRef<string>('');
  const reviewedSpecRef = useRef<string>('');

  const stateValue = typeof snapshot.value === 'string' ? snapshot.value : 'idle';
  const context = snapshot.context;

  function handleStart(prompt: string, githubIssueUrl?: string) {
    void startPipeline(prompt, githubIssueUrl);
  }

  function handleResume() {
    send({ type: 'RESUME', pipelineId: '' });
  }

  function handleAssign(stage: string, agent: string) {
    setAgents((prev) => ({
      ...prev,
      [stage as StageName]: {
        adapter: agent as AgentAssignment['adapter'],
        model:
          agent === 'ollama'
            ? prev[stage as StageName].model ?? config.agents[stage as StageName].model
            : undefined,
      },
    }));
  }

  function handleApprove() {
    send({ type: 'APPROVE' });
  }

  function handleFeedback(text: string) {
    send({ type: 'FEEDBACK', text });
  }

  async function startPipeline(prompt: string, githubIssueUrl?: string) {
    setGithubIssueError(undefined);
    setGithubReport(undefined);

    try {
      if (!githubIssueUrl?.trim()) {
        send({ type: 'START', prompt });
        return;
      }

      const token = getGitHubToken();
      if (!token) {
        setGithubIssueError('GITHUB_TOKEN is required when using a GitHub issue URL.');
        return;
      }

      const issueContext = await fetchGitHubIssueContext(
        parseGitHubIssueUrl(githubIssueUrl),
        token,
      );
      githubIssueContextRef.current = issueContext;
      githubTokenRef.current = token;
      send({ type: 'START', prompt: buildGitHubIssuePrompt(issueContext, prompt) });
    } catch (err) {
      setGithubIssueError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (
      initialPrompt === undefined ||
      initialPrompt.trim() === '' ||
      autoStartedRef.current ||
      stateValue !== 'idle'
    ) {
      return;
    }

    autoStartedRef.current = true;
    void startPipeline(initialPrompt.trim(), initialGithubIssueUrl);
  }, [initialGithubIssueUrl, initialPrompt, stateValue]);

  useEffect(() => {
    if (
      stateValue !== 'complete' &&
      stateValue !== 'failed' &&
      stateValue !== 'cancelled'
    ) {
      return;
    }

    const issueContext = githubIssueContextRef.current;
    const token = githubTokenRef.current;
    if (!issueContext || !token) {
      return;
    }

    const runKey = `${context.pipelineId}:${stateValue}`;
    if (reportedRunKeyRef.current === runKey) {
      return;
    }
    reportedRunKeyRef.current = runKey;

    const result = buildHeadlessResultFromContext(stateValue, context, specContentRef.current);
    void postGitHubIssueComment(
      issueContext.ref,
      token,
      buildGitHubReport(result, issueContext),
    ).then(setGithubReport);
  }, [context, stateValue]);

  useEffect(() => {
    if (
      stateValue !== 'specifying' &&
      stateValue !== 'reviewing' &&
      stateValue !== 'specAssessing' &&
      stateValue !== 'executing' &&
      stateValue !== 'codeAssessing' &&
      stateValue !== 'fixing' &&
      stateValue !== 'documenting'
    ) {
      activeRunKeyRef.current = null;
      return;
    }

    const runKey = `${stateValue}:${context.pipelineId}:${context.iteration}:${context.specQaIterations}:${context.codeQaIterations}`;
    if (activeRunKeyRef.current === runKey) {
      return;
    }
    activeRunKeyRef.current = runKey;

    const stage: StageName = resolveAgentStage(stateValue);
    const assignment = agents[stage];

    let cancelled = false;
    const adapter = createAdapter(assignmentToAdapterConfig(assignment, config.ollama.host));

    setStageOutput('');
    if (stage === 'execute' && stateValue !== 'fixing') {
      setExecuteTests([]);
    }

    void (async () => {
      try {
        assertAdapterInstalled(assignment, detection);

        const prompt = await buildPromptForState({
          stateValue,
          context,
          config,
          latestSpecContent: specContentRef.current,
          latestReviewedSpecContent: reviewedSpecRef.current,
        });
        const startedAt = Date.now();
        const executionOutputDir =
          stateValue === 'executing'
            ? await prepareExecutionOutputDir(config.outputDir, context.prompt, context.pipelineId)
            : undefined;
        const stageWorkspace = await resolveWorkspaceForState({
          stateValue,
          stage,
          context,
          executionOutputDir,
        });

        const documentationBaseline =
          stateValue === 'documenting' && stageWorkspace
            ? await captureDocumentationBaseline(stageWorkspace)
            : undefined;

        let output = '';
        for await (const chunk of adapter.run(prompt, {
          cwd: stageWorkspace,
          allowTools:
            stateValue === 'executing' ||
            stateValue === 'fixing' ||
            stateValue === 'documenting',
        })) {
          if (cancelled) {
            return;
          }

          output += chunk;
          setStageOutput((prev) => prev + chunk);

          if (stateValue === 'executing' || stateValue === 'fixing') {
            setExecuteTests(parseExecutionProgress(output));
          }
        }

        if (cancelled) {
          return;
        }

        if (stage === 'spec') {
          specContentRef.current = output.trim();
          send({ type: 'SPEC_COMPLETE', spec: createSpec(specContentRef.current, context.iteration) });
          return;
        }

        if (stage === 'review') {
          const previousReviewedSpec = reviewedSpecRef.current;
          const parsed = parseReviewOutput(output, context.iteration, context.iteration);
          reviewedSpecRef.current = parsed.reviewedSpec.content;
          setPreviousSpecContent(previousReviewedSpec === '' ? undefined : previousReviewedSpec);
          send({ type: 'REVIEW_COMPLETE', reviewedSpec: parsed.reviewedSpec, score: parsed.score });
          return;
        }

        if (stateValue === 'specAssessing') {
          const assessment = parseQaOutput(output, 'spec', Date.now() - startedAt);
          send({
            type: 'SPEC_QA_COMPLETE',
            assessment,
            maxReached:
              context.specQaIterations + 1 >= config.quality.maxSpecQaIterations,
          });
          return;
        }

        if (stateValue === 'codeAssessing') {
          const assessment = parseQaOutput(output, 'code', Date.now() - startedAt);
          send({
            type: 'CODE_QA_COMPLETE',
            assessment,
            maxReached:
              context.codeQaIterations + 1 >= config.quality.maxCodeQaIterations,
          });
          return;
        }

        if (stateValue === 'documenting') {
          if (!stageWorkspace || !documentationBaseline) {
            throw new Error('Cannot finalize documentation without an output directory');
          }
          const result = await finalizeDocumentationResult(
            stageWorkspace,
            documentationBaseline,
            output,
            Date.now() - startedAt,
          );
          send({ type: 'DOCS_COMPLETE', result });
          return;
        }

        const result = await finalizeExecutionResult(
          stageWorkspace ?? config.outputDir,
          output,
          Date.now() - startedAt,
        );
        setExecuteTests(parseExecutionProgress(output));
        send(
          stateValue === 'fixing'
            ? { type: 'CODE_FIX_COMPLETE', result }
            : { type: 'EXECUTE_COMPLETE', result },
        );
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          send({ type: 'ERROR', error: message });
        }
      }
    })();

    return () => {
      cancelled = true;
      adapter.cancel();
    };
  }, [agents, config.outputDir, context, detection, send, stateValue]);

  const planningStages = [
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
      name: 'QA',
      status: 'waiting' as const,
      agent: agents.qa.adapter,
    },
    {
      name: 'Execute',
      status: 'waiting' as const,
      agent: agents.execute.adapter,
    },
    {
      name: 'Docs',
      status: 'waiting' as const,
      agent: agents.docs.adapter,
    },
  ];

  if (stateValue === 'idle') {
    return React.createElement(WelcomeScreen, {
      onStart: handleStart,
      onResume: handleResume,
      detection,
      agents,
      onAssign: handleAssign,
      initialGithubIssueUrl,
      githubIssueError,
    });
  }

  if (stateValue === 'specifying' || stateValue === 'reviewing' || stateValue === 'specAssessing') {
    const stageName =
      stateValue === 'specifying' ? 'Spec' : stateValue === 'reviewing' ? 'Review' : 'QA';
    const agentKey: StageName =
      stateValue === 'specifying' ? 'spec' : stateValue === 'reviewing' ? 'review' : 'qa';
    const stages = planningStages.map((s) => ({
      ...s,
      status:
        s.name === stageName
          ? ('active' as const)
          : planningStages.indexOf(s) < planningStages.findIndex((bs) => bs.name === stageName)
            ? ('complete' as const)
            : ('waiting' as const),
    }));

    return React.createElement(PipelineScreen, {
      stages,
      iteration: context.iteration,
      output: stageOutput,
      streaming: true,
      stageName,
      agentName: agents[agentKey].adapter,
    });
  }

  if (stateValue === 'feedback') {
    const stages = planningStages.map((s, i) => ({
      ...s,
      status: i < 3 ? ('complete' as const) : ('waiting' as const),
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
      previousSpecContent,
      onApprove: handleApprove,
      onFeedback: handleFeedback,
    });
  }

  if (stateValue === 'executing') {
    const stages = planningStages.map((s, i) => ({
      ...s,
      status:
        i < 3
          ? ('complete' as const)
          : i === 3
            ? ('active' as const)
            : ('waiting' as const),
    }));

    return React.createElement(ExecuteScreen, {
      stages,
      iteration: context.iteration,
      output: stageOutput,
      streaming: true,
      tests: executeTests,
    });
  }

  if (stateValue === 'codeAssessing' || stateValue === 'fixing') {
    const stages = [
      { name: 'Spec', status: 'complete' as const, agent: agents.spec.adapter },
      { name: 'Review', status: 'complete' as const, agent: agents.review.adapter },
      { name: 'Execute', status: stateValue === 'fixing' ? ('active' as const) : ('complete' as const), agent: agents.execute.adapter },
      { name: 'QA', status: stateValue === 'codeAssessing' ? ('active' as const) : ('waiting' as const), agent: agents.qa.adapter },
      { name: 'Docs', status: 'waiting' as const, agent: agents.docs.adapter },
    ];

    return React.createElement(PipelineScreen, {
      stages,
      iteration: context.iteration,
      output: stageOutput,
      streaming: true,
      stageName: stateValue === 'fixing' ? 'Execute Fix' : 'Code QA',
      agentName: agents[stateValue === 'fixing' ? 'execute' : 'qa'].adapter,
    });
  }

  if (stateValue === 'documenting') {
    const stages = [
      { name: 'Spec', status: 'complete' as const, agent: agents.spec.adapter },
      { name: 'Review', status: 'complete' as const, agent: agents.review.adapter },
      { name: 'Execute', status: 'complete' as const, agent: agents.execute.adapter },
      { name: 'QA', status: 'complete' as const, agent: agents.qa.adapter },
      { name: 'Docs', status: 'active' as const, agent: agents.docs.adapter },
    ];

    return React.createElement(PipelineScreen, {
      stages,
      iteration: context.iteration,
      output: stageOutput,
      streaming: true,
      stageName: 'Docs',
      agentName: agents.docs.adapter,
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
      qaAssessments: context.qaAssessments,
      documentationResult: context.documentationResult,
      githubReport,
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

export default function App({ initialPrompt, initialGithubIssueUrl, config, detection }: AppProps) {
  const initialContext = createPipelineContext({
    prompt: initialPrompt ?? '',
    agents: {
      spec: assignmentToAdapterConfig(config.agents.spec, config.ollama.host),
      review: assignmentToAdapterConfig(config.agents.review, config.ollama.host),
      qa: assignmentToAdapterConfig(config.agents.qa, config.ollama.host),
      execute: assignmentToAdapterConfig(config.agents.execute, config.ollama.host),
      docs: assignmentToAdapterConfig(config.agents.docs, config.ollama.host),
    },
    outputDir: config.outputDir,
  });

  return React.createElement(
    ConfigProvider,
    { config, detection },
    React.createElement(
      PipelineProvider,
      { initialContext },
      React.createElement(AppRouter, { initialPrompt, initialGithubIssueUrl, config, detection }),
    ),
  );
}

function buildHeadlessResultFromContext(
  stateValue: string,
  context: ReturnType<typeof createPipelineContext>,
  fallbackSpec: string,
): HeadlessResult {
  const result = context.executionResult;

  return {
    version: 1,
    success: stateValue === 'complete',
    spec: context.reviewedSpec?.content ?? context.spec?.content ?? fallbackSpec,
    filesCreated: result?.filesCreated ?? [],
    outputDir: result?.outputDir ?? context.outputDir,
    testsTotal: result?.testsTotal ?? 0,
    testsPassing: result?.testsPassing ?? 0,
    testsFailing: result?.testsFailing ?? 0,
    duration: Date.now() - context.startedAt.getTime(),
    qaAssessments: context.qaAssessments,
    documentationResult: context.documentationResult,
    ...(stateValue === 'complete' ? {} : { error: context.error ?? `Pipeline ${stateValue}` }),
  };
}

function resolveAgentStage(stateValue: string): StageName {
  if (stateValue === 'specifying') return 'spec';
  if (stateValue === 'reviewing') return 'review';
  if (stateValue === 'specAssessing' || stateValue === 'codeAssessing') return 'qa';
  if (stateValue === 'documenting') return 'docs';
  return 'execute';
}

async function buildPromptForState({
  stateValue,
  context,
  config,
  latestSpecContent,
  latestReviewedSpecContent,
}: {
  stateValue: string;
  context: ReturnType<typeof createPipelineContext>;
  config: PipelineConfig;
  latestSpecContent: string;
  latestReviewedSpecContent: string;
}): Promise<string> {
  if (stateValue === 'specAssessing') {
    return buildSpecQaPrompt(context.prompt, latestReviewedSpecContent);
  }

  if (stateValue === 'codeAssessing') {
    if (!context.executionResult) {
      throw new Error('Cannot run code QA before execution completes');
    }
    const snapshot = await collectProjectSnapshot(context.executionResult.outputDir);
    return buildCodeQaPrompt(
      latestReviewedSpecContent,
      context.executionResult,
      snapshot,
    );
  }

  if (stateValue === 'fixing') {
    const lastAssessment = [...context.qaAssessments]
      .reverse()
      .find((assessment) => assessment.target === 'code');
    if (!context.executionResult || !lastAssessment) {
      throw new Error('Cannot fix code before code QA produces findings');
    }
    return buildCodeFixPrompt(
      latestReviewedSpecContent,
      qaAssessmentToFeedback(lastAssessment),
      context.executionResult.outputDir,
    );
  }

  if (stateValue === 'documenting') {
    if (!context.executionResult) {
      throw new Error('Cannot document before execution completes');
    }
    const snapshot = await collectProjectSnapshot(context.executionResult.outputDir);
    return buildDocsPrompt({
      reviewedSpecContent: latestReviewedSpecContent,
      executionResult: context.executionResult,
      qaAssessments: context.qaAssessments,
      projectSnapshot: snapshot,
    });
  }

  return buildStagePrompt({
    stage: resolveAgentStage(stateValue),
    context,
    latestSpecContent,
    latestReviewedSpecContent,
  });
}

async function resolveWorkspaceForState({
  stateValue,
  stage,
  context,
  executionOutputDir,
}: {
  stateValue: string;
  stage: StageName;
  context: ReturnType<typeof createPipelineContext>;
  executionOutputDir?: string;
}): Promise<string | undefined> {
  if (stateValue === 'executing') {
    return executionOutputDir;
  }

  if (stateValue === 'codeAssessing' || stateValue === 'fixing' || stateValue === 'documenting') {
    return context.executionResult?.outputDir;
  }

  if (stage === 'execute') {
    return executionOutputDir;
  }

  if (stage === 'spec' || stage === 'review' || stage === 'qa') {
    return prepareStageWorkspace(context.pipelineId, stage, context.iteration);
  }

  throw new Error(`Unsupported workspace stage: ${stage}`);
}

function qaAssessmentToFeedback(assessment: { summary: string; findings: string[]; requiredChanges: string[] }) {
  return [
    assessment.summary,
    ...assessment.findings.map((finding) => `FINDING: ${finding}`),
    ...assessment.requiredChanges.map((change) => `REQUIRED_CHANGE: ${change}`),
  ]
    .filter(Boolean)
    .join('\n');
}
