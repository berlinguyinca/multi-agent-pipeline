import * as path from 'path';
import * as fs from 'node:fs/promises';
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
import type {
  AgentAssignment,
  HeadlessRuntimeConfig,
  PipelineConfig,
  StageName,
} from '../types/config.js';
import type { AgentDefinition } from '../types/agent-definition.js';
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
  buildGitHubReportV2,
  fetchGitHubIssueContext,
  parseGitHubIssueUrl,
  postGitHubIssueComment,
} from '../github/issues.js';
import { resolveGitHubToken } from '../github/token.js';
import { buildAdapterChain, runWithFailover } from '../adapters/failover-runner.js';
import { createReporter, type VerboseReporter } from '../utils/verbose-reporter.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/types.js';
import type { SecurityConfig } from '../security/types.js';
import { isAbortError } from '../utils/error.js';
import { DEFAULT_ROUTER_CONSENSUS_CONFIG } from '../config/defaults.js';
import {
  generateAgentSummary,
  saveFinalReportMarkdown,
  saveStageMarkdown,
  saveStepMarkdown,
} from '../output/markdown-artifacts.js';

export type ActorFactory = (context: PipelineContext) => PipelineActor;
export type AdapterFactory = (context: PipelineContext['agents'][keyof PipelineContext['agents']]) => AgentAdapter;

function buildRouterAdapters(config: PipelineConfig, createAdapterFn: AdapterFactory): AgentAdapter[] {
  const consensus = config.router.consensus ?? {
    ...DEFAULT_ROUTER_CONSENSUS_CONFIG,
  };
  const models =
    config.router.adapter === 'ollama' && consensus.enabled
      ? (consensus.models.length > 0 ? consensus.models : [config.router.model])
      : [config.router.model];

  return models.slice(0, 3).map((model) =>
    createAdapterFn({
      type: config.router.adapter,
      model,
    }),
  );
}

function applyHeadlessRouterOverrides(config: PipelineConfig, options: HeadlessOptions): void {
  if (options.routerModel !== undefined) {
    config.router = {
      ...config.router,
      model: options.routerModel,
    };
  }
  if (options.routerConsensusModels !== undefined) {
    config.router = {
      ...config.router,
      consensus: {
        ...(config.router.consensus ?? {
          ...DEFAULT_ROUTER_CONSENSUS_CONFIG,
        }),
        enabled: true,
        models: options.routerConsensusModels,
        scope: 'router',
        mode: 'majority',
      },
    };
  }
}

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
          specFilePath: options.specFilePath,
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
          specFilePath: options.specFilePath,
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
          specFilePath: options.specFilePath,
          error: 'Pipeline cancelled',
        });
        return;
      }
    });

    actor.start();
    actor.send({
      type: 'START',
      prompt: options.prompt,
      initialSpec: options.initialSpec ? createSpec(options.initialSpec) : undefined,
      specFilePath: options.specFilePath,
    });
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
    const outputDir = path.resolve(options.outputDir ?? process.cwd());
    await fs.mkdir(outputDir, { recursive: true });

    const context = createPipelineContext({
      prompt: options.prompt,
      initialSpec: options.initialSpec,
      specFilePath: options.specFilePath,
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
      outputDir: path.resolve(options.outputDir ?? process.cwd()),
      testsTotal: 0,
      testsPassing: 0,
      testsFailing: 0,
      duration: Date.now() - startTime,
      specFilePath: options.specFilePath,
      error: message,
    };
  }
}

async function runHeadlessLive(
  options: HeadlessOptions,
  dependencies: HeadlessDependencies,
): Promise<HeadlessResult> {
  const startTime = Date.now();
  const reporter = createReporter(options.verbose ?? false);
  let issueContext: GitHubIssueContext | undefined;
  let githubToken: string | undefined;
  const outputDir = path.resolve(options.outputDir ?? process.cwd());
  const markdownFiles: string[] = [];

  async function finish(result: HeadlessResult): Promise<HeadlessResult> {
    try {
      markdownFiles.push(
        await saveFinalReportMarkdown({
          outputRoot: result.outputDir || outputDir,
          pipelineId: `v1-${startTime}`,
          title: 'Final Pipeline Report',
          executionGraph: [],
          content: result.documentationResult?.rawOutput ?? result.spec,
          filesCreated: result.filesCreated,
        }),
      );
      result = { ...result, markdownFiles };
    } catch {
      result = { ...result, markdownFiles };
    }

    reporter.pipelineComplete(result.success, result.duration);
    reporter.dispose();

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
    applyHeadlessRouterOverrides(config, options);
    const detection = await dependencies.detectAllAdaptersFn(config.ollama.host);
    await fs.mkdir(outputDir, { recursive: true });
    const prompt = await resolveHeadlessPrompt(options, config, dependencies, (context, token) => {
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
      initialSpec: options.initialSpec,
      specFilePath: options.specFilePath,
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
    reporter.pipelineStart(prompt);

    const qaAssessments: QaAssessment[] = [];
    const reviewedSpecText = await runSpecReviewQaLoop(
      context,
      dependencies,
      runtimeConfig,
      runtimeState,
      config,
      qaAssessments,
      reporter,
    );

    reporter.stageStart('execute');
    let executionResult = await runExecuteStage(
      context,
      dependencies,
      runtimeConfig,
      runtimeState,
      config,
      reviewedSpecText,
      undefined,
      reporter,
    );
    reporter.stageComplete('execute', Date.now() - runtimeState.lastActivityAt);

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
      reporter.stageStart('qa');
      const assessment = await runCodeQaStage(
        context,
        dependencies,
        runtimeConfig,
        runtimeState,
        config,
        reviewedSpecText,
        executionResult,
        reporter,
      );
      qaAssessments.push(assessment);
      reporter.stageComplete('qa', Date.now() - runtimeState.lastActivityAt);
      reporter.codeQaResult(assessment.passed, attempt, config.quality.maxCodeQaIterations);

      if (assessment.passed) {
        reporter.stageStart('docs');
        const documentationResult = await runDocsStage(
          context,
          dependencies,
          runtimeConfig,
          runtimeState,
          config,
          reviewedSpecText,
          executionResult,
          qaAssessments,
          reporter,
        );
        reporter.stageComplete('docs', Date.now() - runtimeState.lastActivityAt);

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
        specFilePath: options.specFilePath,
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
          specFilePath: options.specFilePath,
          error: `Code QA failed after ${attempt} iteration${attempt === 1 ? '' : 's'}`,
        });
      }

      reporter.stageStart('execute');
      executionResult = await runCodeFixStage(
        context,
        dependencies,
        runtimeConfig,
        runtimeState,
        config,
        reviewedSpecText,
        assessment,
        executionResult.outputDir,
        reporter,
      );
      reporter.stageComplete('execute', Date.now() - runtimeState.lastActivityAt);

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
      specFilePath: options.specFilePath,
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
      outputDir,
      testsTotal: 0,
      testsPassing: 0,
      testsFailing: 0,
      duration: Date.now() - startTime,
      specFilePath: options.specFilePath,
      error: message,
    });
  }
}

async function resolveHeadlessPrompt(
  options: HeadlessOptions,
  config: PipelineConfig,
  dependencies: HeadlessDependencies,
  onContext: (context: GitHubIssueContext, token: string) => void,
): Promise<string> {
  if (!options.githubIssueUrl) {
    return options.prompt;
  }

  const token = await resolveGitHubToken(config, dependencies.env);
  if (!token) {
    throw new Error(
      'GitHub token not found. Set GITHUB_TOKEN, add github.token to pipeline.yaml, or run "gh auth login"',
    );
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
  const securityConfig = resolveSecurityConfig(config);
  assertAdapterInstalled(config.agents.spec, detection);
  assertAdapterInstalled(config.agents.review, detection);
  assertAdapterInstalled(config.agents.qa, detection);
  assertAdapterInstalled(config.agents.execute, detection);
  assertAdapterInstalled(config.agents.docs, detection);
  if (securityConfig.enabled && securityConfig.llmReviewEnabled) {
    assertAdapterInstalled({ adapter: securityConfig.adapter } as AgentAssignment, detection);
  }
}

function resolveSecurityConfig(config: PipelineConfig): SecurityConfig {
  return {
    ...DEFAULT_SECURITY_CONFIG,
    ...(config.security ?? {}),
  };
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
  config: PipelineConfig,
  latestSpecContent = '',
  latestReviewedSpecContent = '',
  reporter?: VerboseReporter,
): Promise<string> {
  const chain = buildAdapterChain(config.agents.spec, config.ollama.host);
  const prompt = buildStagePrompt({
    stage: 'spec',
    context,
    latestSpecContent,
    latestReviewedSpecContent,
    personality: context.personality,
  });

  const workspace = await prepareStageWorkspace(context.pipelineId, 'spec', context.iteration);
  return (
    await runWithFailover(chain, dependencies.createAdapterFn, (adapter) =>
      collectAdapterOutput(adapter, prompt, {
        cwd: workspace,
        allowTools: false,
        stage: 'spec',
        runtimeConfig,
        runtimeState,
        reporter,
      }),
    )
  ).trim();
}

async function runReviewStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  config: PipelineConfig,
  specText: string,
  reporter?: VerboseReporter,
): Promise<{ reviewedSpec: ReviewedSpec; score: RefinementScore }> {
  const chain = buildAdapterChain(config.agents.review, config.ollama.host);
  const prompt = buildStagePrompt({
    stage: 'review',
    context,
    latestSpecContent: specText,
    latestReviewedSpecContent: '',
    personality: context.personality,
  });

  const workspace = await prepareStageWorkspace(context.pipelineId, 'review', context.iteration);
  const output = await runWithFailover(chain, dependencies.createAdapterFn, (adapter) =>
    collectAdapterOutput(adapter, prompt, {
      cwd: workspace,
      allowTools: false,
      stage: 'review',
      runtimeConfig,
      runtimeState,
      reporter,
    }),
  );
  return parseReviewOutput(output, context.iteration, context.spec?.version ?? 1);
}

async function runSpecReviewQaLoop(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  config: PipelineConfig,
  qaAssessments: QaAssessment[],
  reporter?: VerboseReporter,
): Promise<string> {
  let latestSpecText = context.initialSpec ?? '';
  let latestReviewedSpecText = '';

  for (let attempt = 1; attempt <= config.quality.maxSpecQaIterations; attempt += 1) {
    markActivity(runtimeState);
    let specText = latestSpecText;
    if (!(attempt === 1 && context.initialSpec)) {
      reporter?.stageStart('spec', attempt);
      specText = await runSpecStage(
        context,
        dependencies,
        runtimeConfig,
        runtimeState,
        config,
        latestSpecText,
        latestReviewedSpecText,
        reporter,
      );
      reporter?.stageComplete('spec', Date.now() - runtimeState.lastActivityAt);
      markActivity(runtimeState);
      context.spec = createSpec(specText, context.iteration);
      latestSpecText = specText;
    } else {
      context.spec = createSpec(specText, context.iteration);
    }

    reporter?.stageStart('review', attempt);
    const review = await runReviewStage(
      context,
      dependencies,
      runtimeConfig,
      runtimeState,
      config,
      specText,
      reporter,
    );
    reporter?.stageComplete('review', Date.now() - runtimeState.lastActivityAt);
    markActivity(runtimeState);
    context.reviewedSpec = review.reviewedSpec;
    context.refinementScores = [...context.refinementScores, review.score];
    latestReviewedSpecText = review.reviewedSpec.content;

    reporter?.stageStart('qa', attempt);
    const assessment = await runSpecQaStage(
      context,
      dependencies,
      runtimeConfig,
      runtimeState,
      config,
      review.reviewedSpec.content,
      reporter,
    );
    reporter?.stageComplete('qa', Date.now() - runtimeState.lastActivityAt);
      qaAssessments.push(assessment);
      reporter?.specQaResult(assessment.passed, attempt, config.quality.maxSpecQaIterations);

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
  config: PipelineConfig,
  reviewedSpecText: string,
  reporter?: VerboseReporter,
): Promise<QaAssessment> {
  const chain = buildAdapterChain(config.agents.qa, config.ollama.host);
  const basePrompt = buildSpecQaPrompt(context.initialSpec ?? context.prompt, reviewedSpecText);
  const prompt = context.personality
    ? `[PERSONALITY DIRECTIVE]\n${context.personality}\n[END PERSONALITY DIRECTIVE]\n\n${basePrompt}`
    : basePrompt;
  const workspace = await prepareStageWorkspace(context.pipelineId, 'qa', context.iteration);
  const startedAt = Date.now();
  const output = await runWithFailover(chain, dependencies.createAdapterFn, (adapter) =>
    collectAdapterOutput(adapter, prompt, {
      cwd: workspace,
      allowTools: false,
      stage: 'qa',
      runtimeConfig,
      runtimeState,
      reporter,
    }),
  );

  return parseQaOutput(output, 'spec', Date.now() - startedAt);
}

async function runExecuteStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  config: PipelineConfig,
  reviewedSpecText: string,
  executionOutputDir?: string,
  reporter?: VerboseReporter,
): Promise<ExecutionResult> {
  const outputDir =
    executionOutputDir ??
    (await prepareExecutionOutputDir(context.outputDir, context.prompt, context.pipelineId));
  const chain = buildAdapterChain(config.agents.execute, config.ollama.host);
  const prompt = buildStagePrompt({
    stage: 'execute',
    context,
    latestSpecContent: context.spec?.content ?? '',
    latestReviewedSpecContent: reviewedSpecText,
    personality: context.personality,
  });
  const startedAt = Date.now();
  const output = await runWithFailover(chain, dependencies.createAdapterFn, (adapter) =>
    collectAdapterOutput(adapter, prompt, {
      cwd: outputDir,
      allowTools: true,
      stage: 'execute',
      runtimeConfig,
      runtimeState,
      reporter,
    }),
  );

  return finalizeExecutionResult(outputDir, output, Date.now() - startedAt);
}

async function runCodeQaStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  config: PipelineConfig,
  reviewedSpecText: string,
  executionResult: ExecutionResult,
  reporter?: VerboseReporter,
): Promise<QaAssessment> {
  const chain = buildAdapterChain(config.agents.qa, config.ollama.host);
  const snapshot = await collectProjectSnapshot(executionResult.outputDir);
  const basePrompt = buildCodeQaPrompt(reviewedSpecText, executionResult, snapshot);
  const prompt = context.personality
    ? `[PERSONALITY DIRECTIVE]\n${context.personality}\n[END PERSONALITY DIRECTIVE]\n\n${basePrompt}`
    : basePrompt;
  const startedAt = Date.now();
  const output = await runWithFailover(chain, dependencies.createAdapterFn, (adapter) =>
    collectAdapterOutput(adapter, prompt, {
      cwd: executionResult.outputDir,
      allowTools: false,
      stage: 'qa',
      runtimeConfig,
      runtimeState,
      reporter,
    }),
  );

  return parseQaOutput(output, 'code', Date.now() - startedAt);
}

async function runDocsStage(
  context: PipelineContext,
  dependencies: HeadlessDependencies,
  runtimeConfig: HeadlessRuntimeConfig,
  runtimeState: RuntimeState,
  config: PipelineConfig,
  reviewedSpecText: string,
  executionResult: ExecutionResult,
  qaAssessments: QaAssessment[],
  reporter?: VerboseReporter,
): Promise<DocumentationResult> {
  const chain = buildAdapterChain(config.agents.docs, config.ollama.host);
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
  const output = await runWithFailover(chain, dependencies.createAdapterFn, (adapter) =>
    collectAdapterOutput(adapter, prompt, {
      cwd: executionResult.outputDir,
      allowTools: true,
      stage: 'docs',
      runtimeConfig,
      runtimeState,
      reporter,
    }),
  );

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
  config: PipelineConfig,
  reviewedSpecText: string,
  assessment: QaAssessment,
  outputDir: string,
  reporter?: VerboseReporter,
): Promise<ExecutionResult> {
  const chain = buildAdapterChain(config.agents.execute, config.ollama.host);
  const basePrompt = buildCodeFixPrompt(reviewedSpecText, qaFeedbackText(assessment), outputDir);
  const prompt = context.personality
    ? `[PERSONALITY DIRECTIVE]\n${context.personality}\n[END PERSONALITY DIRECTIVE]\n\n${basePrompt}`
    : basePrompt;
  const startedAt = Date.now();
  const output = await runWithFailover(chain, dependencies.createAdapterFn, (adapter) =>
    collectAdapterOutput(
      adapter,
      prompt,
      {
        cwd: outputDir,
        allowTools: true,
        stage: 'execute',
        runtimeConfig,
        runtimeState,
        reporter,
      },
    ),
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
  reporter?: VerboseReporter;
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
        if (isAbortError(event.error)) {
          throwIfTimedOut(options.runtimeState, options.runtimeConfig, options.stage, controller, adapter);
          throw new Error(`Operation aborted during ${options.stage}`);
        }
        throw event.error;
      }

      if (event.value.done) {
        markActivity(options.runtimeState);
        break;
      }

      output += event.value.value;
      options.reporter?.onChunk(event.value.value.length);
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
  const reporter = createReporter(options.verbose ?? false);
  const outputDir = path.resolve(options.outputDir ?? process.cwd());
  const markdownFiles: string[] = [];
  let issueContext: GitHubIssueContext | undefined;
  let githubToken: string | undefined;

  async function finish(result: HeadlessResultV2): Promise<HeadlessResultV2> {
    reporter.dispose();

    if (!issueContext || !githubToken) {
      return result;
    }

    const githubReport = await postGitHubIssueComment(
      issueContext.ref,
      githubToken,
      buildGitHubReportV2(result, issueContext),
      dependencies.fetchFn,
    );

    return { ...result, githubReport };
  }

  try {
    await fs.mkdir(outputDir, { recursive: true });
    const config = await dependencies.loadConfigFn(options.configPath);
    const securityConfig = resolveSecurityConfig(config);
    const resolvedPrompt = await resolveHeadlessPrompt(options, config, dependencies, (context, token) => {
      issueContext = context;
      githubToken = token;
    });

    const agentsDir = path.join(process.cwd(), 'agents');
    const agents = await loadEnabledAgentRegistry(agentsDir, config);

    if (agents.size === 0) {
      return await finish(buildHeadlessResultV2(
        { plan: [] },
        [],
        Date.now() - startTime,
        'No agents available',
        { outputDir, markdownFiles },
      ));
    }

    reporter.pipelineStart(resolvedPrompt);

    reporter.dagRoutingStart();
    const routeStart = Date.now();
    const routerConfig = {
      ...config.router,
      timeoutMs: options.routerTimeoutMs ?? config.router.timeoutMs,
    };
    const routerAdapters = buildRouterAdapters(config, dependencies.createAdapterFn);
    const decision = await routeTask(resolvedPrompt, agents, routerAdapters, routerConfig);
    if (decision.kind === 'no-match') {
      return await finish(buildHeadlessResultV2(
        { plan: [] },
        [],
        Date.now() - startTime,
        formatRouterNoMatch(decision),
        { outputDir, markdownFiles },
      ));
    }

    const plan = decision.plan;
    markdownFiles.push(
      await saveStageMarkdown({
        outputRoot: outputDir,
        pipelineId: `v2-${startTime}`,
        iteration: 1,
        stage: 'router-plan',
        title: 'Router Plan',
        content: JSON.stringify(plan, null, 2),
      }),
    );
    reporter.dagRoutingComplete(plan.plan.length, Date.now() - routeStart);

    const dagResult = await executeDAG(plan, agents, dependencies.createAdapterFn, reporter, {
      config: securityConfig,
      createReviewAdapter: () =>
        dependencies.createAdapterFn({
          type: securityConfig.adapter,
          model: securityConfig.model,
          ...(securityConfig.adapter === 'ollama' ? { host: config.ollama.host } : {}),
        }),
    }, undefined, undefined, {
      stepTimeoutMs: config.router.stepTimeoutMs,
      maxStepRetries: config.router.maxStepRetries,
      retryDelayMs: config.router.retryDelayMs,
      adapterDefaults: config.adapterDefaults,
      workingDir: outputDir,
      knowledgeCwd: process.cwd(),
      adaptiveReplanning: {
        enabled: true,
        refreshAgents: () => loadEnabledAgentRegistry(agentsDir, config),
      },
    });

    const duration = Date.now() - startTime;
    const pipelineId = `v2-${startTime}`;
    for (const [index, step] of dagResult.steps.entries()) {
      markdownFiles.push(
        await saveStepMarkdown({
          outputRoot: outputDir,
          pipelineId,
          order: index + 1,
          stepId: step.id,
          agent: step.agent,
          task: step.task,
          status: step.status,
          content: step.output ?? step.error ?? step.reason ?? '',
        }),
      );
    }
    const finalStep = [...dagResult.steps]
      .reverse()
      .find((step) => step.status === 'completed' && step.output?.trim());
    markdownFiles.push(
      await saveFinalReportMarkdown({
        outputRoot: outputDir,
        pipelineId,
        title: finalStep ? `Generated Report - ${finalStep.id} [${finalStep.agent}]` : 'Generated Report',
        executionGraph: plan.plan.map((step) => {
          const result = dagResult.steps.find((candidate) => candidate.id === step.id);
          return {
            id: step.id,
            agent: step.agent,
            provider: result?.provider,
            model: result?.model,
            task: step.task,
            status: result?.status ?? 'pending',
            duration: result?.duration,
            dependsOn: step.dependsOn,
          };
        }),
        content: finalStep?.output ?? '',
        filesCreated: dagResult.steps.flatMap((step) => step.filesCreated ?? []),
      }),
    );
    if (config.generateAgentSummary) {
      markdownFiles.push(
        await generateAgentSummary({
          outputRoot: outputDir,
          pipelineId,
          duration,
          success: dagResult.success,
          steps: dagResult.steps,
        }),
      );
    }
    reporter.dagComplete(dagResult.success, duration);
    return await finish(buildHeadlessResultV2(plan, dagResult.steps, duration, undefined, {
      outputDir,
      markdownFiles,
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return await finish(buildHeadlessResultV2({ plan: [] }, [], Date.now() - startTime, message, {
      outputDir,
      markdownFiles,
    }));
  }
}

async function loadEnabledAgentRegistry(
  agentsDir: string,
  config: PipelineConfig,
): Promise<Map<string, AgentDefinition>> {
  const rawAgents = await loadAgentRegistry(agentsDir);

  for (const [name, overrides] of Object.entries(config.agentOverrides)) {
    const base = rawAgents.get(name);
    if (base) {
      rawAgents.set(name, mergeWithOverrides(base, overrides));
    }
  }

  return getEnabledAgents(rawAgents);
}

function formatRouterNoMatch(decision: {
  reason: string;
  suggestedAgent?: { name: string; description: string };
}): string {
  const reason = decision.reason.trim().replace(/[.]+$/, '');
  const suggestion = decision.suggestedAgent
    ? ` Suggested agent: ${decision.suggestedAgent.name} — ${decision.suggestedAgent.description}.`
    : '';
  return `No suitable agent available. ${reason}.${suggestion} Create one with: map agent create`;
}
