import * as path from 'path';
import * as fs from 'node:fs/promises';
import { loadConfig } from '../config/loader.js';
import { detectAllAdapters } from '../adapters/detect.js';
import { createAdapter } from '../adapters/adapter-factory.js';
import { createPipelineActor } from '../pipeline/machine.js';
import { createPipelineContext } from '../pipeline/context.js';
import type { PipelineContext } from '../types/pipeline.js';
import type { HeadlessAgentComparison, HeadlessJudgePanel, HeadlessJudgePanelVote, HeadlessOptions, HeadlessResult, HeadlessResultV2 } from '../types/headless.js';
import { loadAgentRegistry, getEnabledAgents, mergeWithOverrides } from '../agents/registry.js';
import { executeDAG } from '../orchestrator/orchestrator.js';
import { buildHeadlessResultV2 } from './result-builder.js';
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
  OllamaConfig,
  PipelineConfig,
  StageName,
} from '../types/config.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { DAGPlan, RouterRationale } from '../types/dag.js';
import type { AdapterType, DetectionResult, AgentAdapter } from '../types/adapter.js';
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
import { probeOllamaConcurrencyCapacity } from '../adapters/ollama-capabilities.js';
import { ensureOllamaReady } from '../adapters/ollama-runtime.js';
import { selectFinalCompletedStep } from '../dag/final-step.js';
import { formatRouterNoMatch, routeWithAutonomousRecovery } from './router-recovery.js';
import {
  generateAgentSummary,
  saveFinalReportMarkdown,
  saveStageMarkdown,
  saveStepMarkdown,
} from '../output/markdown-artifacts.js';

export type ActorFactory = (context: PipelineContext) => PipelineActor;
export type AdapterFactory = (context: PipelineContext['agents'][keyof PipelineContext['agents']]) => AgentAdapter;

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

function applyHeadlessOllamaOverrides(config: PipelineConfig, options: HeadlessOptions): void {
  if (options.ollama === undefined) return;
  config.ollama = {
    ...config.ollama,
    ...options.ollama,
  } as OllamaConfig;
}

function applyHeadlessDisabledAgentOverrides(config: PipelineConfig, options: HeadlessOptions): void {
  const disabledAgents = options.disabledAgents;
  if (!disabledAgents || disabledAgents.length === 0) return;
  const existingOverrides = config.agentOverrides ?? {};
  config.agentOverrides = {
    ...existingOverrides,
    ...Object.fromEntries(
      disabledAgents.map((name) => [
        name,
        {
          ...(existingOverrides[name] ?? {}),
          enabled: false,
        },
      ]),
    ),
  };
}

function applyHeadlessCrossReviewOverrides(config: PipelineConfig, options: HeadlessOptions): void {
  if (
    options.crossReviewEnabled === undefined &&
    options.crossReviewMaxRounds === undefined &&
    options.crossReviewJudgeModels === undefined
  ) {
    return;
  }
  const next = {
    ...config.crossReview,
    judge: { ...config.crossReview.judge },
  };
  if (options.crossReviewEnabled !== undefined) next.enabled = options.crossReviewEnabled;
  if (options.crossReviewMaxRounds !== undefined) {
    if (options.crossReviewMaxRounds > next.maxRoundsUpperBound) {
      throw new Error(`--cross-review-max-rounds must be at most ${next.maxRoundsUpperBound}`);
    }
    next.maxRounds = options.crossReviewMaxRounds;
  }
  if (options.crossReviewJudgeModels !== undefined) {
    next.judge.models = [...options.crossReviewJudgeModels];
  }
  config.crossReview = next;
}

function logRouterAgentDecisions(
  reporter: Pick<VerboseReporter, 'agentDecision'>,
  rationale: RouterRationale | undefined,
  plan: DAGPlan,
): void {
  const selected = new Set<string>();
  for (const entry of rationale?.selectedAgents ?? []) {
    selected.add(entry.agent);
    reporter.agentDecision({
      by: 'router',
      agent: entry.agent,
      decision: 'selected',
      reason: entry.reason,
    });
  }

  for (const agent of new Set(plan.plan.map((step) => step.agent))) {
    if (selected.has(agent)) continue;
    reporter.agentDecision({
      by: 'router',
      agent,
      decision: 'selected',
      reason: 'planned in the execution DAG',
    });
  }

  for (const entry of rationale?.rejectedAgents ?? []) {
    reporter.agentDecision({
      by: 'router',
      agent: entry.agent,
      decision: 'skipped',
      reason: entry.reason,
    });
  }
}

function buildRerunHints(options: HeadlessOptions): HeadlessResultV2['rerun'] {
  const args = ['map', '--headless'];
  if (options.configPath) args.push('--config', quoteShellArg(options.configPath));
  if (options.specFilePath) args.push('--spec-file', quoteShellArg(options.specFilePath));
  if (options.workspaceDir) args.push('--workspace-dir', quoteShellArg(options.workspaceDir));
  if (options.outputDir) args.push('--output-dir', quoteShellArg(options.outputDir));
  if (options.routerModel) args.push('--router-model', quoteShellArg(options.routerModel));
  if (options.routerConsensusModels && options.routerConsensusModels.length > 0) {
    args.push('--router-consensus-models', quoteShellArg(options.routerConsensusModels.join(',')));
  }
  if (options.disabledAgents && options.disabledAgents.length > 0) {
    args.push('--disable-agent', quoteShellArg(options.disabledAgents.join(',')));
  }
  if (options.crossReviewEnabled === false) args.push('--disable-cross-review');
  if (options.crossReviewMaxRounds !== undefined) {
    args.push('--cross-review-max-rounds', String(options.crossReviewMaxRounds));
  }
  if (options.crossReviewJudgeModels && options.crossReviewJudgeModels.length > 0) {
    args.push('--cross-review-judge-models', quoteShellArg(options.crossReviewJudgeModels.join(',')));
  }
  const promptTail = options.specFilePath ? options.rerunPrompt?.trim() : options.prompt;
  if (promptTail) {
    args.push(quoteShellArg(promptTail));
  }
  return {
    command: args.join(' '),
    disableAgentFlag: '--disable-agent <agent-name>',
    ...(options.disabledAgents && options.disabledAgents.length > 0
      ? { disabledAgents: [...options.disabledAgents] }
      : {}),
  };
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=,+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface HeadlessDependencies {
  loadConfigFn: typeof loadConfig;
  detectAllAdaptersFn: typeof detectAllAdapters;
  createAdapterFn: AdapterFactory;
  probeOllamaConcurrencyCapacityFn?: typeof probeOllamaConcurrencyCapacity;
  ensureOllamaModelReadyFn?: typeof ensureOllamaReady;
  agentsDir?: string;
  fetchFn?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

const defaultDependencies: HeadlessDependencies = {
  loadConfigFn: loadConfig,
  detectAllAdaptersFn: detectAllAdapters,
  createAdapterFn: createAdapter,
  probeOllamaConcurrencyCapacityFn: probeOllamaConcurrencyCapacity,
  ensureOllamaModelReadyFn: ensureOllamaReady,
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
    applyHeadlessOllamaOverrides(config, options);
    const outputDir = path.resolve(options.outputDir ?? process.cwd());
    await fs.mkdir(outputDir, { recursive: true });

    const context = createPipelineContext({
      prompt: options.prompt,
      initialSpec: options.initialSpec,
      specFilePath: options.specFilePath,
      agents: {
        spec: assignmentToAdapterConfig(config.agents.spec, config.ollama),
        review: assignmentToAdapterConfig(config.agents.review, config.ollama),
        qa: assignmentToAdapterConfig(config.agents.qa, config.ollama),
        execute: assignmentToAdapterConfig(config.agents.execute, config.ollama),
        docs: assignmentToAdapterConfig(config.agents.docs, config.ollama),
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
    applyHeadlessOllamaOverrides(config, options);
    applyHeadlessRouterOverrides(config, options);
    applyHeadlessDisabledAgentOverrides(config, options);
    applyHeadlessCrossReviewOverrides(config, options);
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
        spec: assignmentToAdapterConfig(config.agents.spec, config.ollama),
        review: assignmentToAdapterConfig(config.agents.review, config.ollama),
        qa: assignmentToAdapterConfig(config.agents.qa, config.ollama),
        execute: assignmentToAdapterConfig(config.agents.execute, config.ollama),
        docs: assignmentToAdapterConfig(config.agents.docs, config.ollama),
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
  const chain = buildAdapterChain(config.agents.spec, config.ollama);
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
  const chain = buildAdapterChain(config.agents.review, config.ollama);
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
  const chain = buildAdapterChain(config.agents.qa, config.ollama);
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
  const chain = buildAdapterChain(config.agents.execute, config.ollama);
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
  const chain = buildAdapterChain(config.agents.qa, config.ollama);
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
  const chain = buildAdapterChain(config.agents.docs, config.ollama);
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
  const chain = buildAdapterChain(config.agents.execute, config.ollama);
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
  const outputDir = path.resolve(options.outputDir ?? process.cwd());
  if (options.compareAgents !== undefined) {
    return runHeadlessV2Comparison(options, dependencies, outputDir, startTime);
  }
  const reporter = createReporter(options.verbose ?? false);
  const markdownFiles: string[] = [];
  let workspaceDir: string | undefined;
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
    applyHeadlessOllamaOverrides(config, options);
    applyHeadlessRouterOverrides(config, options);
    applyHeadlessDisabledAgentOverrides(config, options);
    applyHeadlessCrossReviewOverrides(config, options);
    workspaceDir = path.resolve(options.workspaceDir ?? config.workspaceDir ?? outputDir);
    await fs.mkdir(workspaceDir, { recursive: true });
    const securityConfig = resolveSecurityConfig(config);
    const baseResolvedPrompt = await resolveHeadlessPrompt(options, config, dependencies, (context, token) => {
      issueContext = context;
      githubToken = token;
    });
    const resolvedPrompt = appendWorkspaceContext(baseResolvedPrompt, workspaceDir, outputDir);

    const agentsDir = dependencies.agentsDir ?? path.join(process.cwd(), 'agents');
    let agents = await loadEnabledAgentRegistry(agentsDir, config);

    if (agents.size === 0) {
      const finalResult = buildHeadlessResultV2(
        { plan: [] },
        [],
        Date.now() - startTime,
        'No agents available',
        { outputDir, workspaceDir, markdownFiles, rerun: buildRerunHints(options) },
      );
      await recordAgentPerformance(finalResult, workspaceDir);
      return await finish(finalResult);
    }

    reporter.pipelineStart(resolvedPrompt);

    reporter.dagRoutingStart();
    const routeStart = Date.now();
    const probeConcurrency =
      dependencies.probeOllamaConcurrencyCapacityFn ??
      (dependencies.createAdapterFn === createAdapter ? probeOllamaConcurrencyCapacity : undefined);
    const ollamaConcurrency =
      config.router.adapter === 'ollama' && probeConcurrency
        ? await probeConcurrency({
            ...config.ollama,
            model: config.router.model,
            models:
              config.router.consensus?.models && config.router.consensus.models.length > 0
                ? config.router.consensus.models
                : [config.router.model, config.router.model, config.router.model],
            maxParallel: 3,
          })
        : { maxParallel: 1 };
    const routerConfig = {
      ...config.router,
      timeoutMs: options.routerTimeoutMs ?? config.router.timeoutMs,
      ollamaConcurrency: ollamaConcurrency.maxParallel,
    };
    const routing = await routeWithAutonomousRecovery({
      resolvedPrompt,
      basePrompt: baseResolvedPrompt,
      agents,
      agentsDir,
      config,
      routerConfig,
      reloadAgents: () => loadEnabledAgentRegistry(agentsDir, config),
      reporter,
      dependencies: {
        createAdapterFn: dependencies.createAdapterFn,
        detectAllAdaptersFn: dependencies.detectAllAdaptersFn,
        ensureOllamaModelReadyFn: dependencies.ensureOllamaModelReadyFn,
      },
    });
    agents = routing.agents;
    const decision = routing.decision;
    const agentDiscovery = routing.agentDiscovery;
    if (decision.kind === 'no-match') {
      const finalResult = buildHeadlessResultV2(
        { plan: [] },
        [],
        Date.now() - startTime,
        formatRouterNoMatch(decision),
        {
          outputDir,
          workspaceDir,
          markdownFiles,
          rerun: buildRerunHints(options),
          routerRationale: decision.rationale,
          agentDiscovery,
          semanticJudge: buildSemanticJudge(options, null),
        },
      );
      await recordAgentPerformance(finalResult, workspaceDir);
      return await finish(finalResult);
    }

    const plan = decision.plan;
    logRouterAgentDecisions(reporter, decision.rationale, plan);
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
          ...(securityConfig.adapter === 'ollama' ? config.ollama : {}),
        }),
    }, undefined, undefined, {
      stepTimeoutMs: config.router.stepTimeoutMs,
      maxStepRetries: config.router.maxStepRetries,
      retryDelayMs: config.router.retryDelayMs,
      adapterDefaults: config.adapterDefaults,
      agentConsensus: config.agentConsensus,
      evidence: config.evidence,
      crossReview: config.crossReview,
      qaRepairMaxRounds: config.quality.maxCodeQaIterations,
      localModelConcurrency: ollamaConcurrency.maxParallel,
      workingDir: workspaceDir,
      knowledgeCwd: workspaceDir,
      workspaceInstruction: buildWorkspaceInstruction(workspaceDir, outputDir, baseResolvedPrompt),
      adaptiveReplanning: {
        enabled: true,
        refreshAgents: () => loadEnabledAgentRegistry(agentsDir, config),
      },
      handoffValidation: {
        reviewedSpecContent: options.initialSpec,
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
    const finalStep = selectFinalCompletedStep(dagResult.plan, dagResult.steps);
    markdownFiles.push(
      await saveFinalReportMarkdown({
        outputRoot: outputDir,
        pipelineId,
        title: finalStep ? `Generated Report - ${finalStep.id} [${finalStep.agent}]` : 'Generated Report',
        executionGraph: dagResult.plan.plan.map((step) => {
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
            consensus: result?.consensus
              ? {
                method: result.consensus.method,
                selectedRun: result.consensus.selectedRun,
                participants: result.consensus.participants,
              }
              : undefined,
          };
        }),
        content: finalStep?.output ?? '',
        filesCreated: dagResult.steps.flatMap((step) => step.filesCreated ?? []),
        consensusDiagnostics: decision.consensus ? [decision.consensus] : [],
        rerun: buildRerunHints(options),
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
    let finalResult = buildHeadlessResultV2(dagResult.plan, dagResult.steps, duration, undefined, {
      outputDir,
      workspaceDir,
      markdownFiles,
      consensusDiagnostics: decision.consensus ? [decision.consensus] : [],
      rerun: buildRerunHints(options),
      routerRationale: decision.rationale,
      agentDiscovery,
      semanticJudge: buildSemanticJudge(options, null),
    });
    finalResult = await maybeApplyJudgePanel({
      result: finalResult,
      prompt: baseResolvedPrompt,
      options,
      config,
      dependencies,
      outputDir,
    });
    await recordAgentPerformance(finalResult, workspaceDir);
    return await finish(finalResult);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const finalResult = buildHeadlessResultV2({ plan: [] }, [], Date.now() - startTime, message, {
      outputDir,
      ...(typeof workspaceDir !== 'undefined' ? { workspaceDir } : {}),
      markdownFiles,
      rerun: buildRerunHints(options),
      semanticJudge: buildSemanticJudge(options, null),
    });
    await recordAgentPerformance(finalResult, workspaceDir ?? outputDir);
    return await finish(finalResult);
  }
}

async function runHeadlessV2Comparison(
  options: HeadlessOptions,
  dependencies: HeadlessDependencies,
  outputDir: string,
  startedAt: number,
): Promise<HeadlessResultV2> {
  await fs.mkdir(outputDir, { recursive: true });
  const baseline = await runHeadlessV2({
    ...options,
    compareAgents: undefined,
    outputDir: path.join(outputDir, 'comparison-baseline'),
    githubIssueUrl: undefined,
  }, dependencies);
  const candidates = resolveComparisonCandidates(options, baseline);
  const comparisons: HeadlessAgentComparison[] = [];
  const markdownFiles = [...baseline.markdownFiles];

  for (const agent of candidates) {
    const variant = await runHeadlessV2({
      ...options,
      compareAgents: undefined,
      disabledAgents: [...new Set([...(options.disabledAgents ?? []), agent])],
      outputDir: path.join(outputDir, `comparison-without-${safePathSegment(agent)}`),
      githubIssueUrl: undefined,
    }, dependencies);
    markdownFiles.push(...variant.markdownFiles);
    comparisons.push(compareAgentVariant(agent, baseline, variant));
  }

  const semanticJudge = buildSemanticJudge(options, comparisons);
  const result: HeadlessResultV2 = {
    ...baseline,
    outputDir,
    markdownFiles,
    duration: Date.now() - startedAt,
    rerun: buildRerunHints(options),
    ...(comparisons.length > 0 ? { agentComparisons: comparisons } : {}),
    ...(semanticJudge ? { semanticJudge } : {}),
  };
  await recordAgentPerformance(result, outputDir, comparisons);
  return result;
}

async function maybeApplyJudgePanel(options: {
  result: HeadlessResultV2;
  prompt: string;
  options: HeadlessOptions;
  config: PipelineConfig;
  dependencies: HeadlessDependencies;
  outputDir: string;
}): Promise<HeadlessResultV2> {
  const judgeSpecs = resolveJudgePanelSpecs(options.options, options.config);
  if (judgeSpecs.length === 0 || options.result.steps.length === 0) {
    return options.result;
  }

  const maxSteeringRounds = options.options.judgePanelSteer === true
    ? Math.max(0, options.options.judgePanelMaxSteeringRounds ?? 1)
    : 0;
  const rounds: HeadlessJudgePanel['rounds'] = [];
  let current = options.result;
  let steeringApplied = false;
  let lastSteeringPrompt: string | undefined;
  let lastSteeringOutputDir: string | undefined;
  let finalPanel: HeadlessJudgePanel | undefined;

  for (let round = 1; round <= maxSteeringRounds + 1; round += 1) {
    const panel = await runJudgePanel({
      result: current,
      prompt: options.prompt,
      judges: judgeSpecs,
      config: options.config,
      createAdapterFn: options.dependencies.createAdapterFn,
    });
    rounds.push({
      round,
      verdict: panel.verdict,
      voteCount: panel.voteCount,
      votes: panel.votes,
      improvements: panel.improvements,
      rationale: panel.rationale,
    });
    finalPanel = panel;

    const shouldSteer =
      round <= maxSteeringRounds &&
      panel.verdict !== 'accept';
    if (!shouldSteer) break;

    const steeringPrompt = buildJudgePanelSteeringPrompt(options.prompt, panel);
    const steeringOutputDir = path.join(options.outputDir, `judge-panel-steered-${round}`);
    const steered = await runHeadlessV2({
      ...options.options,
      prompt: steeringPrompt,
      githubIssueUrl: undefined,
      outputDir: steeringOutputDir,
      judgePanelModels: undefined,
      judgePanelSteer: false,
      judgePanelMaxSteeringRounds: 0,
      compareAgents: undefined,
    }, options.dependencies);

    current = {
      ...steered,
      outputDir: options.outputDir,
      markdownFiles: [...current.markdownFiles, ...steered.markdownFiles],
    };
    steeringApplied = true;
    lastSteeringPrompt = steeringPrompt;
    lastSteeringOutputDir = steeringOutputDir;
  }

  if (!finalPanel) return current;
  const allImprovements = uniqueStrings(rounds.flatMap((round) => round.improvements));
  return {
    ...current,
    outputDir: options.outputDir,
    markdownFiles: current.markdownFiles,
    judgePanel: {
      ...finalPanel,
      rounds,
      improvements: finalPanel.improvements.length > 0 ? finalPanel.improvements : allImprovements,
      steeringApplied,
      ...(lastSteeringPrompt ? { steeringPrompt: lastSteeringPrompt } : {}),
      ...(lastSteeringOutputDir ? { steeringOutputDir: lastSteeringOutputDir } : {}),
    },
  };
}

interface JudgeSpec {
  adapter: AdapterType;
  model: string;
  label: string;
  role?: string;
}

function resolveJudgePanelSpecs(options: HeadlessOptions, config: PipelineConfig): JudgeSpec[] {
  if (options.judgePanelModels && options.judgePanelModels.length > 0) {
    return uniqueJudgeSpecs(options.judgePanelModels.map((entry, index) =>
      withJudgeRole(parseJudgeSpec(entry, config.router.adapter), options.judgePanelRoles, index),
    ));
  }
  if (options.judgePanelSteer !== true) {
    return [];
  }
  const consensusModels = config.router.consensus?.models ?? [];
  const models = consensusModels.length > 0
    ? consensusModels
    : [config.router.model, config.router.model, config.router.model];
  return uniqueJudgeSpecs(models.slice(0, 3).map((model, index) => withJudgeRole({
    adapter: config.router.adapter,
    model,
    label: `${config.router.adapter}/${model}`,
  }, options.judgePanelRoles, index)));
}

function withJudgeRole(spec: JudgeSpec, roles: string[] | undefined, index: number): JudgeSpec {
  const role = roles?.[index] ?? defaultJudgeRole(index);
  return role ? { ...spec, role } : spec;
}

function defaultJudgeRole(index: number): string {
  return ['evidence-skeptic', 'recency-auditor', 'contradiction-finder', 'user-value-judge'][index % 4]!;
}

function parseJudgeSpec(value: string, defaultAdapter: AdapterType): JudgeSpec {
  const trimmed = value.trim();
  const slash = trimmed.indexOf('/');
  if (slash > 0) {
    const adapter = trimmed.slice(0, slash);
    const model = trimmed.slice(slash + 1);
    if (isAdapterType(adapter) && model.trim().length > 0) {
      return { adapter, model: model.trim(), label: `${adapter}/${model.trim()}` };
    }
  }
  return { adapter: defaultAdapter, model: trimmed, label: `${defaultAdapter}/${trimmed}` };
}

function isAdapterType(value: string): value is AdapterType {
  return value === 'ollama' || value === 'claude' || value === 'codex' || value === 'hermes';
}

function uniqueJudgeSpecs(specs: JudgeSpec[]): JudgeSpec[] {
  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = `${spec.adapter}/${spec.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return spec.model.length > 0;
  });
}

async function runJudgePanel(options: {
  result: HeadlessResultV2;
  prompt: string;
  judges: JudgeSpec[];
  config: PipelineConfig;
  createAdapterFn: AdapterFactory;
}): Promise<HeadlessJudgePanel> {
  const finalOutput = extractComparableFinalOutput(options.result);
  const promptForJudge = (judge: JudgeSpec) => buildJudgePanelPrompt(options.prompt, options.result, finalOutput, judge.role);
  const votes = await Promise.all(options.judges.map(async (judge, index) => {
    const adapter = options.createAdapterFn(
      judge.adapter === 'ollama'
        ? { type: judge.adapter, model: judge.model, ...options.config.ollama }
        : { type: judge.adapter, model: judge.model },
    );
    try {
      let output = '';
      for await (const chunk of adapter.run(promptForJudge(judge), {
        responseFormat: 'json',
        hideThinking: true,
        think: false,
        systemPrompt: 'Return only valid JSON for the MAP outcome judge vote.',
      })) {
        output += chunk;
      }
      return normalizeJudgeVote(output, index + 1, adapter.type, judge.model, judge.role);
    } catch (error) {
      return {
        run: index + 1,
        ...(judge.role ? { role: judge.role } : {}),
        provider: adapter.type,
        model: judge.model,
        verdict: 'revise' as const,
        confidence: 0,
        improvements: ['Judge run failed; manually review this outcome.'],
        rationale: error instanceof Error ? error.message : String(error),
        shouldSteer: false,
      };
    }
  }));
  return buildJudgePanelResult(votes);
}

function buildJudgePanelPrompt(prompt: string, result: HeadlessResultV2, finalOutput: string, role: string | undefined): string {
  const steps = result.steps.map((step) => ({
    id: step.id,
    agent: step.agent,
    status: step.status,
    task: step.task,
    error: step.error,
  }));
  return [
    'You are a MAP outcome judge. Vote independently on whether the completed DAG outcome satisfies the user task.',
    role ? `Your adversarial judge role is: ${role}.` : '',
    role ? judgeRoleInstruction(role) : '',
    '',
    'Return ONLY JSON with this shape:',
    '{"verdict":"accept|revise|reject","confidence":0.0,"improvements":["specific improvement"],"rationale":"brief reason","shouldSteer":true}',
    '',
    'User task:',
    prompt,
    '',
    'DAG steps:',
    JSON.stringify(steps, null, 2),
    '',
    'Final output:',
    finalOutput || '(no final output captured)',
  ].join('\n');
}

function normalizeJudgeVote(
  output: string,
  run: number,
  provider: string,
  model: string,
  role: string | undefined,
): HeadlessJudgePanelVote {
  const parsed = parseFirstJsonObject(output);
  const verdict = parsed?.['verdict'] === 'accept' || parsed?.['verdict'] === 'reject' || parsed?.['verdict'] === 'revise'
    ? parsed['verdict']
    : 'revise';
  const improvements = Array.isArray(parsed?.['improvements'])
    ? parsed!['improvements'].map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  return {
    run,
    ...(role ? { role } : {}),
    provider,
    model,
    verdict,
    confidence: clamp01(Number(parsed?.['confidence'] ?? 0)),
    improvements,
    rationale: String(parsed?.['rationale'] ?? '').trim(),
    shouldSteer: parsed?.['shouldSteer'] === true,
  };
}

function judgeRoleInstruction(role: string): string {
  switch (role) {
    case 'evidence-skeptic':
      return 'Focus on unsupported claims, weak evidence, fabricated citations, and whether claims have direct evidence.';
    case 'recency-auditor':
      return 'Focus on stale evidence, currentness, publication/retrieval dates, and whether current claims are actually current.';
    case 'contradiction-finder':
      return 'Focus on internal contradictions and conflicts between outputs, claims, and evidence.';
    case 'user-value-judge':
      return 'Focus on whether the final answer satisfies the user task clearly and actionably.';
    default:
      return `Apply the ${role} perspective rigorously and state what would improve the answer.`;
  }
}

function parseFirstJsonObject(output: string): Record<string, unknown> | null {
  const start = output.indexOf('{');
  if (start === -1) return null;
  for (let end = output.length; end > start; end -= 1) {
    const candidate = output.slice(start, end).trim();
    if (!candidate.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      continue;
    }
  }
  return null;
}

function buildJudgePanelResult(votes: HeadlessJudgePanelVote[]): HeadlessJudgePanel {
  const verdict = majorityVerdict(votes);
  const improvements = uniqueStrings(votes.flatMap((vote) => vote.improvements));
  return {
    enabled: true,
    verdict,
    voteCount: votes.length,
    votes,
    improvements,
    rationale: votes.map((vote) => `${vote.model ?? vote.run}: ${vote.rationale}`).filter(Boolean).join('\n'),
    steeringApplied: false,
  };
}

function majorityVerdict(votes: HeadlessJudgePanelVote[]): HeadlessJudgePanel['verdict'] {
  const weight = new Map<HeadlessJudgePanel['verdict'], number>([
    ['accept', 0],
    ['revise', 0],
    ['reject', 0],
  ]);
  for (const vote of votes) {
    weight.set(vote.verdict, (weight.get(vote.verdict) ?? 0) + Math.max(0.01, vote.confidence || 0.5));
    if (vote.shouldSteer && vote.verdict === 'accept') {
      weight.set('revise', (weight.get('revise') ?? 0) + 0.25);
    }
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'revise';
}

function buildJudgePanelSteeringPrompt(prompt: string, panel: HeadlessJudgePanel): string {
  return [
    prompt,
    '',
    '--- MAP Judge Panel Steering Feedback ---',
    `Panel verdict: ${panel.verdict}`,
    'Required improvements:',
    ...panel.improvements.map((improvement) => `- ${improvement}`),
    '',
    'Revise the DAG plan and final output to address this feedback. Preserve correct prior work, but add missing verification, clarity, and user-facing guidance requested by the judges.',
  ].join('\n');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function resolveComparisonCandidates(options: HeadlessOptions, baseline: HeadlessResultV2): string[] {
  if (options.compareAgents && options.compareAgents.length > 0) {
    return [...new Set(options.compareAgents)];
  }
  const fromContributions = baseline.agentContributions?.map((entry) => entry.agent) ?? [];
  if (fromContributions.length > 0) return [...new Set(fromContributions)];
  return [...new Set(baseline.steps.map((step) => step.agent))];
}

function compareAgentVariant(
  disabledAgent: string,
  baseline: HeadlessResultV2,
  variant: HeadlessResultV2,
): HeadlessAgentComparison {
  const similarity = textSimilarity(extractComparableFinalOutput(baseline), extractComparableFinalOutput(variant));
  return {
    disabledAgent,
    baselineSuccess: baseline.success,
    variantSuccess: variant.success,
    baselineDuration: baseline.duration,
    variantDuration: variant.duration,
    finalSimilarity: similarity,
    recommendation: recommendAgent(disabledAgent, baseline, variant, similarity),
    variantOutputDir: variant.outputDir,
  };
}

function recommendAgent(
  agent: string,
  baseline: HeadlessResultV2,
  variant: HeadlessResultV2,
  similarity: number,
): string {
  if (baseline.success && !variant.success) return `Keep ${agent}: disabling it caused the comparison run to fail.`;
  if (baseline.success && similarity < 0.6) return `Keep ${agent}: disabling it materially changed the final output.`;
  if (variant.success && variant.duration < baseline.duration * 0.8 && similarity >= 0.85) {
    return `Consider disabling ${agent}: output stayed similar while runtime improved.`;
  }
  return `Review ${agent}: comparison was inconclusive.`;
}

function buildSemanticJudge(
  options: HeadlessOptions,
  comparisons: HeadlessAgentComparison[] | null,
): HeadlessResultV2['semanticJudge'] {
  if (!options.semanticJudge) return undefined;
  const score = comparisons && comparisons.length > 0
    ? comparisons.reduce((sum, comparison) => sum + comparison.finalSimilarity, 0) / comparisons.length
    : 1;
  return {
    enabled: true,
    method: 'deterministic-output-similarity',
    score,
    verdict: score >= 0.85 ? 'equivalent' : score >= 0.6 ? 'needs-review' : 'different',
  };
}

function extractComparableFinalOutput(result: HeadlessResultV2): string {
  const completed = result.steps.filter((step) => step.status === 'completed' || step.status === 'recovered');
  return completed.at(-1)?.output ?? result.error ?? '';
}

function textSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenizeComparisonText(left));
  const rightTokens = new Set(tokenizeComparisonText(right));
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1;
  const union = new Set([...leftTokens, ...rightTokens]);
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return union.size === 0 ? 0 : intersection / union.size;
}

function tokenizeComparisonText(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

function safePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

async function recordAgentPerformance(
  result: HeadlessResultV2,
  rootDir: string,
  comparisons: HeadlessAgentComparison[] = result.agentComparisons ?? [],
): Promise<void> {
  const filePath = path.join(rootDir, '.map', 'agent-performance.json');
  let existing: Record<string, {
    runs: number;
    successes: number;
    failures: number;
    totalDurationMs: number;
    selfOptimizationCandidates: number;
    lastRecommendation?: string;
  }> = {};
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf8')) as typeof existing;
  } catch {
    existing = {};
  }

  for (const contribution of result.agentContributions ?? []) {
    const current = existing[contribution.agent] ?? {
      runs: 0,
      successes: 0,
      failures: 0,
      totalDurationMs: 0,
      selfOptimizationCandidates: 0,
    };
    current.runs += contribution.totalSteps;
    current.successes += contribution.completedSteps + contribution.recoveredSteps;
    current.failures += contribution.failedSteps;
    current.totalDurationMs += result.steps
      .filter((step) => step.agent === contribution.agent)
      .reduce((sum, step) => sum + (step.duration ?? 0), 0);
    if (contribution.selfOptimizationReason) current.selfOptimizationCandidates += 1;
    existing[contribution.agent] = current;
  }

  for (const comparison of comparisons) {
    const current = existing[comparison.disabledAgent] ?? {
      runs: 0,
      successes: 0,
      failures: 0,
      totalDurationMs: 0,
      selfOptimizationCandidates: 0,
    };
    current.lastRecommendation = comparison.recommendation;
    existing[comparison.disabledAgent] = current;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
}

function appendWorkspaceContext(prompt: string, workspaceDir: string, outputDir: string): string {
  return [
    prompt,
    '',
    '--- MAP Workspace Context ---',
    `Workspace directory: ${workspaceDir}`,
    `Report/output directory: ${outputDir}`,
    'Agents must inspect and modify the workspace directory when implementing or extending existing code/data.',
    'Prefer reading existing source files, tests, configuration, and collected artifacts before proposing or applying changes.',
    'When creating or modifying relative paths, resolve them under the workspace directory.',
    ...formatWorkspacePathHints(prompt, workspaceDir),
    'Do not write requested workspace files into the report/output directory unless the user explicitly asks for report artifacts.',
    'Do not treat the report/output directory as the target application unless it is the same path as the workspace directory.',
  ].join('\n');
}

function buildWorkspaceInstruction(workspaceDir: string, outputDir: string, prompt = ''): string {
  return [
    `Workspace directory: ${workspaceDir}`,
    `Report/output directory: ${outputDir}`,
    'Inspect existing workspace sources, tests, configuration, and collected data before creating or modifying files.',
    'Integrate changes into the existing workspace instead of generating isolated code unless the task explicitly asks for a separate artifact.',
    'When creating or modifying relative paths, resolve them under the workspace directory.',
    ...formatWorkspacePathHints(prompt, workspaceDir),
    'Do not write requested workspace files into the report/output directory unless the user explicitly asks for report artifacts.',
  ].join('\n');
}

function formatWorkspacePathHints(prompt: string, workspaceDir: string): string[] {
  const paths = extractWorkspaceRelativePaths(prompt);
  if (paths.length === 0) return [];
  return [
    'Workspace-relative path examples from the request:',
    ...paths.map((entry) => `- ${entry} => ${path.join(workspaceDir, entry)}`),
  ];
}

function extractWorkspaceRelativePaths(prompt: string): string[] {
  const matches = prompt.match(/(?:^|[\s`'"])((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+)(?=$|[\s`'".,;:)])/g) ?? [];
  const paths = matches
    .map((match) => match.trim().replace(/^[`'"]|[`'".,;:)]+$/g, ''))
    .filter((entry) =>
      entry.includes('/') &&
      !entry.startsWith('/') &&
      !entry.startsWith('../') &&
      !entry.includes('://') &&
      !entry.split('/').some((segment) => segment === '..' || segment === ''),
    );
  return [...new Set(paths)].slice(0, 8);
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
