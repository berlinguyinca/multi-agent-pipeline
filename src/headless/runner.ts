import * as path from 'path';
import { loadConfig } from '../config/loader.js';
import { detectAllAdapters } from '../adapters/detect.js';
import { createAdapter } from '../adapters/adapter-factory.js';
import { createPipelineActor } from '../pipeline/machine.js';
import { createPipelineContext } from '../pipeline/context.js';
import type { PipelineContext } from '../types/pipeline.js';
import type { HeadlessOptions, HeadlessResult } from '../types/headless.js';
import { loadAgentRegistry, getEnabledAgents, mergeWithOverrides } from '../agents/registry.js';
import { routeTask } from '../router/router.js';
import { executeDAG } from '../orchestrator/orchestrator.js';
import { buildHeadlessResultV2 } from './result-builder.js';
import type { HeadlessResultV2 } from '../types/headless.js';
import type {
  DocumentationResult,
  ExecutionResult,
  QaAssessment,
  ReviewedSpec,
  RefinementScore,
} from '../types/spec.js';
import type { PipelineActor } from '../pipeline/machine.js';
import {
  assertAdapterInstalled,
  assignmentToAdapterConfig,
  buildStagePrompt,
  captureDocumentationBaseline,
  collectProjectSnapshot,
  finalizeDocumentationResult,
  finalizeExecutionResult,
  parseQaOutput,
  parseReviewOutput,
  prepareExecutionOutputDir,
  prepareStageWorkspace,
} from '../tui/runtime.js';
import { createSpec } from '../types/spec.js';
import type { HeadlessRuntimeConfig, PipelineConfig, StageName } from '../types/config.js';
import type { DetectionResult, AgentAdapter } from '../types/adapter.js';
import type { GitHubIssueContext } from '../types/github.js';
import { validateDurationRelationship } from '../utils/duration.js';
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

export type ActorFactory = (context: PipelineContext) => PipelineActor;
export type AdapterFactory = (context: PipelineContext['agents'][keyof PipelineContext['agents']]) => AgentAdapter;

interface HeadlessDependencies {
  loadConfigFn: typeof loadConfig;
  detectAllAdaptersFn: typeof detectAllAdapters;
  createAdapterFn: AdapterFactory;
  fetchFn?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

const defaultDependencies: HeadlessDependencies = {
  loadConfigFn: loadConfig,
  detectAllAdaptersFn: detectAllAdapters,
  createAdapterFn: createAdapter,
};

class HeadlessTimeoutError extends Error {
  constructor(
    public readonly kind: 'total' | 'inactivity',
    public readonly stage: StageName,
    public readonly elapsedMs: number,
  ) {
    super(
      kind === 'total'
        ? `Timed out: total runtime exceeded during ${stage}`
        : `Timed out: inactivity exceeded during ${stage}`,
    );
    this.name = 'HeadlessTimeoutError';
  }
}

interface RuntimeState {
  startedAt: number;
  lastActivityAt: number;
}

export function runWithActor(
  options: HeadlessOptions,
  outputDir: string,
  actor: PipelineActor,
): Promise<HeadlessResult> {
  const startTime = Date.now();

  return new Promise<HeadlessResult>((resolve) => {
    let specContent = '';
    let resolved = false;

    function finish(result: HeadlessResult) {
      if (!resolved) {
        resolved = true;
        actor.stop();
        resolve(result);
      }
    }

    actor.subscribe((snapshot) => {
      const value = snapshot.value as string;
      const ctx = snapshot.context;

      if (value === 'feedback') {
        // Capture spec content before auto-approving
        if (ctx.reviewedSpec !== null) {
          specContent = ctx.reviewedSpec.content;
        } else if (ctx.spec !== null) {
          specContent = ctx.spec.content;
        }
        // Auto-approve — no user interaction in headless mode
        actor.send({ type: 'APPROVE' });
        return;
      }

      if (value === 'complete') {
        const execResult: ExecutionResult | undefined = ctx.executionResult;
        finish({
          version: 1,
          success: true,
          spec: specContent,
          filesCreated: execResult?.filesCreated ?? [],
          outputDir: execResult?.outputDir ?? outputDir,
          testsTotal: execResult?.testsTotal ?? 0,
          testsPassing: execResult?.testsPassing ?? 0,
          testsFailing: execResult?.testsFailing ?? 0,
          duration: Date.now() - startTime,
          documentationResult: ctx.documentationResult,
        });
        return;
      }

      if (value === 'failed') {
        finish({
          version: 1,
          success: false,
          spec: specContent,
          filesCreated: [],
          outputDir: ctx.outputDir,
          testsTotal: 0,
          testsPassing: 0,
          testsFailing: 0,
          duration: Date.now() - startTime,
          error: ctx.error ?? 'Pipeline failed',
        });
        return;
      }

      if (value === 'cancelled') {
        finish({
          version: 1,
          success: false,
          spec: specContent,
          filesCreated: [],
          outputDir: ctx.outputDir,
          testsTotal: 0,
          testsPassing: 0,
          testsFailing: 0,
          duration: Date.now() - startTime,
          error: 'Pipeline cancelled',
        });
        return;
      }
    });

    actor.start();
    actor.send({ type: 'START', prompt: options.prompt });
  });
}

export async function runHeadless(
  options: HeadlessOptions,
  actorFactory: ActorFactory = createPipelineActor,
  dependencies: HeadlessDependencies = defaultDependencies,
): Promise<HeadlessResult> {
  if (actorFactory !== createPipelineActor) {
    return runHeadlessWithActor(options, actorFactory, dependencies.loadConfigFn);
  }

  return runHeadlessLive(options, dependencies);
}

async function runHeadlessWithActor(
  options: HeadlessOptions,
  actorFactory: ActorFactory,
  loadConfigFn: typeof loadConfig,
): Promise<HeadlessResult> {
  const startTime = Date.now();

  try {
    const config = await loadConfigFn(options.configPath);
    const outputDir = options.outputDir ?? config.outputDir;

    const context = createPipelineContext({
      prompt: options.prompt,
      agents: {
        spec: assignmentToAdapterConfig(config.agents.spec, config.ollama.host),
        review: assignmentToAdapterConfig(config.agents.review, config.ollama.host),
        qa: assignmentToAdapterConfig(config.agents.qa, config.ollama.host),
        execute: assignmentToAdapterConfig(config.agents.execute, config.ollama.host),
        docs: assignmentToAdapterConfig(config.agents.docs, config.ollama.host),
      },
      outputDir,
      personality: options.personality,
    });

    const actor = actorFactory(context);
    return await runWithActor(options, outputDir, actor);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      version: 1,
      success: false,
      spec: '',
      filesCreated: [],
      outputDir: options.outputDir ?? './output',
      testsTotal: 0,
      testsPassing: 0,
      testsFailing: 0,
      duration: Date.now() - startTime,
      error: message,
    };
  }
}

async function runHeadlessLive(
  options: HeadlessOptions,
  dependencies: HeadlessDependencies,
): Promise<HeadlessResult> {
  const startTime = Date.now();
  let issueContext: GitHubIssueContext | undefined;
  let githubToken: string | undefined;

  async function finish(result: HeadlessResult): Promise<HeadlessResult> {
    if (!issueContext || !githubToken) {
      return result;
    }

    const githubReport = await postGitHubIssueComment(
      issueContext.ref,
      githubToken,
      buildGitHubReport(result, issueContext),
      dependencies.fetchFn,
    );

    return { ...result, githubReport };
  }

  try {
    const config = await dependencies.loadConfigFn(options.configPath);
    const detection = await dependencies.detectAllAdaptersFn(config.ollama.host);
    const outputDir = options.outputDir ?? config.outputDir;
    const prompt = await resolveHeadlessPrompt(options, dependencies, (context, token) => {
      issueContext = context;
      githubToken = token;
    });
    const runtimeConfig = resolveHeadlessRuntimeConfig(config, options);
    const runtimeState: RuntimeState = {
      startedAt: startTime,
      lastActivityAt: startTime,
    };

    const context = createPipelineContext({
      prompt,
      agents: {
        spec: assignmentToAdapterConfig(config.agents.spec, config.ollama.host),
        review: assignmentToAdapterConfig(config.agents.review, config.ollama.host),
        qa: assignmentToAdapterConfig(config.agents.qa, config.ollama.host),
        execute: assignmentToAdapterConfig(config.agents.execute, config.ollama.host),
        docs: assignmentToAdapterConfig(config.agents.docs, config.ollama.host),
      },
      outputDir,
      personality: options.personality,
    });

    assertConfiguredAdaptersInstalled(config, detection);

    const qaAssessments: QaAssessment[] = [];
    const reviewedSpecText = await runSpecReviewQaLoop(
      context,
      dependencies,
      runtimeConfig,
      runtimeState,
      config,
      qaAssessments,
    );

    let executionResult = await runExecuteStage(
      context,
      dependencies,
      runtimeConfig,
      runtimeState,
      reviewedSpecText,
    );

    if (!executionResult.success) {
      return await finish({
        version: 1,
        success: false,
        spec: reviewedSpecText,
        filesCreated: executionResult.filesCreated,
        outputDir: executionResult.outputDir,
        testsTotal: executionResult.testsTotal,
        testsPassing: executionResult.testsPassing,
        testsFailing: executionResult.testsFailing,
        duration: Date.now() - startTime,
        qaAssessments,
        error: 'Execution completed with failing tests',
      });
    }

    for (let attempt = 1; attempt <= config.quality.maxCodeQaIterations; attempt += 1) {
      const assessment = await runCodeQaStage(
        context,
        dependencies,
        runtimeConfig,
        runtimeState,
        reviewedSpecText,
        executionResult,
      );
      qaAssessments.push(assessment);

      if (assessment.passed) {
        const documentationResult = await runDocsStage(
          context,
          dependencies,
          runtimeConfig,
          runtimeState,
          reviewedSpecText,
          executionResult,
          qaAssessments,
        );

        return await finish({
          version: 1,
          success: true,
          spec: reviewedSpecText,
          filesCreated: executionResult.filesCreated,
          outputDir: executionResult.outputDir,
          testsTotal: executionResult.testsTotal,
          testsPassing: executionResult.testsPassing,
          testsFailing: executionResult.testsFailing,
          duration: Date.now() - startTime,
          qaAssessments,
          documentationResult,
        });
      }

      if (attempt >= config.quality.maxCodeQaIterations) {
        return await finish({
          version: 1,
          success: false,
          spec: reviewedSpecText,
          filesCreated: executionResult.filesCreated,
          outputDir: executionResult.outputDir,
          testsTotal: executionResult.testsTotal,
          testsPassing: executionResult.testsPassing,
          testsFailing: executionResult.testsFailing,
          duration: Date.now() - startTime,
          qaAssessments,
          error: `Code QA failed after ${attempt} iteration${attempt === 1 ? '' : 's'}`,
        });
      }

      executionResult = await runCodeFixStage(
        context,
        dependencies,
        runtimeConfig,
        runtimeState,
        reviewedSpecText,
        assessment,
        executionResult.outputDir,
      );

      if (!executionResult.success) {
        return await finish({
          version: 1,
          success: false,
          spec: reviewedSpecText,
          filesCreated: executionResult.filesCreated,
          outputDir: executionResult.outputDir,
          testsTotal: executionResult.testsTotal,
          testsPassing: executionResult.testsPassing,
          testsFailing: executionResult.testsFailing,
          duration: Date.now() - startTime,
          qaAssessments,
          error: 'Execution fix completed with failing tests',
        });
      }
    }

    return await finish({
      version: 1,
      success: false,
      spec: reviewedSpecText,
      filesCreated: executionResult.filesCreated,
      outputDir: executionResult.outputDir,
      testsTotal: executionResult.testsTotal,
      testsPassing: executionResult.testsPassing,
      testsFailing: executionResult.testsFailing,
      duration: Date.now() - startTime,
      qaAssessments,
      error: 'Code QA did not complete',
    });
  } catch (err: unknown) {
    const message =
      err instanceof HeadlessTimeoutError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return await finish({
      version: 1,
      success: false,
      spec: '',
      filesCreated: [],
      outputDir: options.outputDir ?? './output',
      testsTotal: 0,
      testsPassing: 0,
      testsFailing: 0,
      duration: Date.now() - startTime,
      error: message,
    });
  }
}

async function resolveHeadlessPrompt(
  options: HeadlessOptions,
  dependencies: HeadlessDependencies,
  onContext: (context: GitHubIssueContext, token: string) => void,
): Promise<string> {
  if (!options.githubIssueUrl) {
    return options.prompt;
  }

  const token = getGitHubToken(dependencies.env);
  if (!token) {
    throw new Error('GITHUB_TOKEN is required when --github-issue is provided');
  }

  const ref = parseGitHubIssueUrl(options.githubIssueUrl);
  const context = await fetchGitHubIssueContext(ref, token, dependencies.fetchFn);
  onContext(context, token);
  return buildGitHubIssuePrompt(context, options.prompt);
}

function assertConfiguredAdaptersInstalled(
  config: PipelineConfig,
  detection: DetectionResult,
): void {
  assertAdapterInstalled(config.agents.spec, detection);
  assertAdapterInstalled(config.agents.review, detection);
  assertAdapterInstalled(config.agents.qa, detection);
  assertAdapterInstalled(config.agents.execute, detection);
  assertAdapterInstalled(config.agents.docs, detection);
}

function resolveHeadlessRuntimeConfig(
  config: PipelineConfig,
  options: HeadlessOptions,
): HeadlessRuntimeConfig {
  const resolved = {
    totalTimeoutMs: options.totalTimeoutMs ?? config.headless.totalTimeoutMs,
    inactivityTimeoutMs:
      options.inactivityTimeoutMs ?? config.headless.inactivityTimeoutMs,
    pollIntervalMs: options.pollIntervalMs ?? config.headless.pollIntervalMs,
  };

  validateDurationRelationship(
    resolved.totalTimeoutMs,
    resolved.inactivityTimeoutMs,
    resolved.pollIntervalMs,
  );

  return resolved;
}

async function runSpecStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  latestSpecContent = '',
  latestReviewedSpecContent = '',
): Promise<string> {
  const adapter = dependencies.createAdapterFn(context.agents.spec);
  const prompt = buildStagePrompt({
    stage: 'spec',
    context,
    latestSpecContent,
    latestReviewedSpecContent,
    personality: context.personality,
  });

  const workspace = await prepareStageWorkspace(context.pipelineId, 'spec', context.iteration);
  return (
    await collectAdapterOutput(adapter, prompt, {
      cwd: workspace,
      allowTools: false,
      stage: 'spec',
      runtimeConfig,
      runtimeState,
    })
  ).trim();
}

async function runReviewStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  specText: string,
): Promise<{ reviewedSpec: ReviewedSpec; score: RefinementScore }> {
  const adapter = dependencies.createAdapterFn(context.agents.review);
  const prompt = buildStagePrompt({
    stage: 'review',
    context,
    latestSpecContent: specText,
    latestReviewedSpecContent: '',
    personality: context.personality,
  });

  const workspace = await prepareStageWorkspace(context.pipelineId, 'review', context.iteration);
  const output = await collectAdapterOutput(adapter, prompt, {
    cwd: workspace,
    allowTools: false,
    stage: 'review',
    runtimeConfig,
    runtimeState,
  });
  return parseReviewOutput(output, context.iteration, context.spec?.version ?? 1);
}

async function runSpecReviewQaLoop(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  config: PipelineConfig,
  qaAssessments: QaAssessment[],
): Promise<string> {
  let latestSpecText = '';
  let latestReviewedSpecText = '';

  for (let attempt = 1; attempt <= config.quality.maxSpecQaIterations; attempt += 1) {
    markActivity(runtimeState);
    const specText = await runSpecStage(
      context,
      dependencies,
      runtimeConfig,
      runtimeState,
      latestSpecText,
      latestReviewedSpecText,
    );
    markActivity(runtimeState);
    context.spec = createSpec(specText, context.iteration);
    latestSpecText = specText;

    const review = await runReviewStage(
      context,
      dependencies,
      runtimeConfig,
      runtimeState,
      specText,
    );
    markActivity(runtimeState);
    context.reviewedSpec = review.reviewedSpec;
    context.refinementScores = [...context.refinementScores, review.score];
    latestReviewedSpecText = review.reviewedSpec.content;

    const assessment = await runSpecQaStage(
      context,
      dependencies,
      runtimeConfig,
      runtimeState,
      review.reviewedSpec.content,
    );
    qaAssessments.push(assessment);

    if (assessment.passed) {
      return review.reviewedSpec.content;
    }

    if (attempt >= config.quality.maxSpecQaIterations) {
      throw new Error(`Spec QA failed after ${attempt} iteration${attempt === 1 ? '' : 's'}`);
    }

    context.feedbackHistory = [...context.feedbackHistory, qaFeedbackText(assessment)];
    context.iteration += 1;
    context.spec = null;
    context.reviewedSpec = null;
  }

  throw new Error('Spec QA did not complete');
}

async function runSpecQaStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  reviewedSpecText: string,
): Promise<QaAssessment> {
  const adapter = dependencies.createAdapterFn(context.agents.qa);
  const basePrompt = buildSpecQaPrompt(context.prompt, reviewedSpecText);
  const prompt = context.personality
    ? `[PERSONALITY DIRECTIVE]\n${context.personality}\n[END PERSONALITY DIRECTIVE]\n\n${basePrompt}`
    : basePrompt;
  const workspace = await prepareStageWorkspace(context.pipelineId, 'qa', context.iteration);
  const startedAt = Date.now();
  const output = await collectAdapterOutput(adapter, prompt, {
    cwd: workspace,
    allowTools: false,
    stage: 'qa',
    runtimeConfig,
    runtimeState,
  });

  return parseQaOutput(output, 'spec', Date.now() - startedAt);
}

async function runExecuteStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  reviewedSpecText: string,
  executionOutputDir?: string,
): Promise<ExecutionResult> {
  const outputDir =
    executionOutputDir ??
    (await prepareExecutionOutputDir(context.outputDir, context.prompt, context.pipelineId));
  const adapter = dependencies.createAdapterFn(context.agents.execute);
  const prompt = buildStagePrompt({
    stage: 'execute',
    context,
    latestSpecContent: context.spec?.content ?? '',
    latestReviewedSpecContent: reviewedSpecText,
    personality: context.personality,
  });
  const startedAt = Date.now();
  const output = await collectAdapterOutput(adapter, prompt, {
    cwd: outputDir,
    allowTools: true,
    stage: 'execute',
    runtimeConfig,
    runtimeState,
  });

  return finalizeExecutionResult(outputDir, output, Date.now() - startedAt);
}

async function runCodeQaStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  reviewedSpecText: string,
  executionResult: ExecutionResult,
): Promise<QaAssessment> {
  const adapter = dependencies.createAdapterFn(context.agents.qa);
  const snapshot = await collectProjectSnapshot(executionResult.outputDir);
  const basePrompt = buildCodeQaPrompt(reviewedSpecText, executionResult, snapshot);
  const prompt = context.personality
    ? `[PERSONALITY DIRECTIVE]\n${context.personality}\n[END PERSONALITY DIRECTIVE]\n\n${basePrompt}`
    : basePrompt;
  const startedAt = Date.now();
  const output = await collectAdapterOutput(adapter, prompt, {
    cwd: executionResult.outputDir,
    allowTools: false,
    stage: 'qa',
    runtimeConfig,
    runtimeState,
  });

  return parseQaOutput(output, 'code', Date.now() - startedAt);
}

async function runDocsStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  reviewedSpecText: string,
  executionResult: ExecutionResult,
  qaAssessments: QaAssessment[],
): Promise<DocumentationResult> {
  const adapter = dependencies.createAdapterFn(context.agents.docs);
  const snapshot = await collectProjectSnapshot(executionResult.outputDir);
  const basePrompt = buildDocsPrompt({
    reviewedSpecContent: reviewedSpecText,
    executionResult,
    qaAssessments,
    projectSnapshot: snapshot,
  });
  const prompt = context.personality
    ? `[PERSONALITY DIRECTIVE]\n${context.personality}\n[END PERSONALITY DIRECTIVE]\n\n${basePrompt}`
    : basePrompt;
  const baseline = await captureDocumentationBaseline(executionResult.outputDir);
  const startedAt = Date.now();
  const output = await collectAdapterOutput(adapter, prompt, {
    cwd: executionResult.outputDir,
    allowTools: true,
    stage: 'docs',
    runtimeConfig,
    runtimeState,
  });

  return finalizeDocumentationResult(
    executionResult.outputDir,
    baseline,
    output,
    Date.now() - startedAt,
  );
}

async function runCodeFixStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  reviewedSpecText: string,
  assessment: QaAssessment,
  outputDir: string,
): Promise<ExecutionResult> {
  const adapter = dependencies.createAdapterFn(context.agents.execute);
  const basePrompt = buildCodeFixPrompt(reviewedSpecText, qaFeedbackText(assessment), outputDir);
  const prompt = context.personality
    ? `[PERSONALITY DIRECTIVE]\n${context.personality}\n[END PERSONALITY DIRECTIVE]\n\n${basePrompt}`
    : basePrompt;
  const startedAt = Date.now();
  const output = await collectAdapterOutput(
    adapter,
    prompt,
    {
      cwd: outputDir,
      allowTools: true,
      stage: 'execute',
      runtimeConfig,
      runtimeState,
    },
  );

  return finalizeExecutionResult(outputDir, output, Date.now() - startedAt);
}

function qaFeedbackText(assessment: QaAssessment): string {
  const requiredChanges = assessment.requiredChanges.length
    ? assessment.requiredChanges.map((change) => `- ${change}`).join('\n')
    : '- Address the QA findings and improve the output until QA passes.';
  const findings = assessment.findings.length
    ? assessment.findings.map((finding) => `- ${finding}`).join('\n')
    : '- No structured findings were provided.';

  return `QA summary:
${assessment.summary || '(no summary)'}

Findings:
${findings}

Required changes:
${requiredChanges}`;
}

interface CollectOutputOptions {
  cwd?: string;
  allowTools: boolean;
  stage: StageName;
  runtimeConfig: HeadlessRuntimeConfig;
  runtimeState: RuntimeState;
}

async function collectAdapterOutput(
  adapter: AgentAdapter,
  prompt: string,
  options: CollectOutputOptions,
): Promise<string> {
  let output = '';
  const controller = new AbortController();
  const iterator = adapter
    .run(prompt, {
      cwd: options.cwd,
      allowTools: options.allowTools,
      signal: controller.signal,
    })
    [Symbol.asyncIterator]();

  markActivity(options.runtimeState);
  let nextPromise: Promise<
    | { type: 'next'; value: IteratorResult<string, void> }
    | { type: 'error'; error: unknown }
  > = iterator
    .next()
    .then((value) => ({ type: 'next' as const, value }))
    .catch((error) => ({ type: 'error' as const, error }));

  try {
    while (true) {
      const event = await Promise.race([
        nextPromise,
        delay(options.runtimeConfig.pollIntervalMs).then(() => ({ type: 'poll' as const })),
      ]);

      if (event.type === 'poll') {
        throwIfTimedOut(options.runtimeState, options.runtimeConfig, options.stage, controller, adapter);
        continue;
      }

      if (event.type === 'error') {
        throw event.error;
      }

      if (event.value.done) {
        markActivity(options.runtimeState);
        break;
      }

      output += event.value.value;
      markActivity(options.runtimeState);
      nextPromise = iterator
        .next()
        .then((value) => ({ type: 'next' as const, value }))
        .catch((error) => ({ type: 'error' as const, error }));
    }
  } finally {
    controller.abort();
    adapter.cancel();
  }

  return output;
}

function throwIfTimedOut(
  runtimeState: RuntimeState,
  runtimeConfig: HeadlessRuntimeConfig,
  stage: StageName,
  controller: AbortController,
  adapter: AgentAdapter,
): void {
  const now = Date.now();
  const totalElapsedMs = now - runtimeState.startedAt;
  const inactivityElapsedMs = now - runtimeState.lastActivityAt;

  if (totalElapsedMs >= runtimeConfig.totalTimeoutMs) {
    controller.abort();
    adapter.cancel();
    throw new HeadlessTimeoutError('total', stage, totalElapsedMs);
  }

  if (inactivityElapsedMs >= runtimeConfig.inactivityTimeoutMs) {
    controller.abort();
    adapter.cancel();
    throw new HeadlessTimeoutError('inactivity', stage, inactivityElapsedMs);
  }
}

function markActivity(runtimeState: RuntimeState): void {
  runtimeState.lastActivityAt = Date.now();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runHeadlessV2(
  options: HeadlessOptions,
  dependencies: HeadlessDependencies = defaultDependencies,
): Promise<HeadlessResultV2> {
  const startTime = Date.now();

  try {
    const config = await dependencies.loadConfigFn(options.configPath);

    const agentsDir = path.join(process.cwd(), 'agents');
    const rawAgents = await loadAgentRegistry(agentsDir);

    for (const [name, overrides] of Object.entries(config.agentOverrides)) {
      const base = rawAgents.get(name);
      if (base) {
        rawAgents.set(name, mergeWithOverrides(base, overrides));
      }
    }

    const agents = getEnabledAgents(rawAgents);

    if (agents.size === 0) {
      return buildHeadlessResultV2({ plan: [] }, [], Date.now() - startTime, 'No agents available');
    }

    const routerAdapter = dependencies.createAdapterFn({
      type: config.router.adapter,
      model: config.router.model,
    });
    const plan = await routeTask(options.prompt, agents, routerAdapter, config.router);

    const dagResult = await executeDAG(plan, agents, dependencies.createAdapterFn);

    return buildHeadlessResultV2(plan, dagResult.steps, Date.now() - startTime);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return buildHeadlessResultV2({ plan: [] }, [], Date.now() - startTime, message);
  }
}
