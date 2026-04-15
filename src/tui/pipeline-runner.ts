import { createPipelineActor } from '../pipeline/machine.js';
import type { PipelineActor } from '../pipeline/machine.js';
import { createPipelineContext } from '../pipeline/context.js';
import { createSpec } from '../types/spec.js';
import type { PipelineContext } from '../types/pipeline.js';
import type { PipelineConfig, AgentAssignment, StageName } from '../types/config.js';
import type { DetectionResult } from '../types/adapter.js';
import type { GitHubIssueContext, GitHubReportResult } from '../types/github.js';
import type { HeadlessResult } from '../types/headless.js';
import type { TestProgressItem } from './runtime.js';
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
} from './runtime.js';
import { createAdapter } from '../adapters/adapter-factory.js';
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
  parseGitHubIssueUrl,
  postGitHubIssueComment,
} from '../github/issues.js';
import { resolveGitHubToken } from '../github/token.js';
import { saveStageMarkdown } from '../output/markdown-artifacts.js';

export type StreamSink = (chunk: string) => void;

export interface PipelineCallbacks {
  onStateChange: (state: string, context: PipelineContext) => void;
  onStreamChunk: StreamSink;
  onTestProgress: (tests: TestProgressItem[]) => void;
  onGithubReport?: (report: GitHubReportResult) => void;
  onMarkdownFile?: (filePath: string) => void;
  onError: (error: string) => void;
}

export class PipelineRunner {
  private actor: PipelineActor;
  private config: PipelineConfig;
  private detection: DetectionResult;
  private callbacks: PipelineCallbacks;
  private agents: Record<StageName, AgentAssignment>;

  private activeRunKey: string | null = null;
  private reportedRunKey: string | null = null;
  private githubIssueContext: GitHubIssueContext | undefined = undefined;
  private githubToken: string | undefined = undefined;
  private specContent: string = '';
  private reviewedSpecContent: string = '';
  private cancelCurrentRun: (() => void) | null = null;
  private subscription: { unsubscribe(): void } | null = null;

  constructor(
    config: PipelineConfig,
    detection: DetectionResult,
    agents: Record<StageName, AgentAssignment>,
    callbacks: PipelineCallbacks,
  ) {
    this.config = config;
    this.detection = detection;
    this.agents = agents;
    this.callbacks = callbacks;

    const initialContext = createPipelineContext({
      prompt: '',
      agents: {
        spec: assignmentToAdapterConfig(config.agents.spec, config.ollama.host),
        review: assignmentToAdapterConfig(config.agents.review, config.ollama.host),
        qa: assignmentToAdapterConfig(config.agents.qa, config.ollama.host),
        execute: assignmentToAdapterConfig(config.agents.execute, config.ollama.host),
        docs: assignmentToAdapterConfig(config.agents.docs, config.ollama.host),
      },
      outputDir: config.outputDir,
    });

    this.actor = createPipelineActor(initialContext);

    this.subscription = this.actor.subscribe((snapshot) => {
      const stateValue =
        typeof snapshot.value === 'string' ? snapshot.value : 'idle';
      const context = snapshot.context;

      this.callbacks.onStateChange(stateValue, context);
      this._handleGithubReport(stateValue, context);
      this._runStageIfNeeded(stateValue, context);
    });

    this.actor.start();
  }

  start(prompt: string, githubIssueUrl?: string): void {
    void this._startAsync(prompt, githubIssueUrl);
  }

  cancel(): void {
    this.cancelCurrentRun?.();
    this.actor.send({ type: 'CANCEL' });
  }

  approve(): void {
    this.actor.send({ type: 'APPROVE' });
  }

  sendFeedback(text: string): void {
    this.actor.send({ type: 'FEEDBACK', text });
  }

  updateAgentAssignment(stage: StageName, agent: AgentAssignment): void {
    this.agents = { ...this.agents, [stage]: agent };
  }

  destroy(): void {
    this.cancelCurrentRun?.();
    this.subscription?.unsubscribe();
    this.actor.stop();
  }

  getActor(): PipelineActor {
    return this.actor;
  }

  private async _startAsync(prompt: string, githubIssueUrl?: string): Promise<void> {
    this.githubIssueContext = undefined;
    this.githubToken = undefined;

    try {
      if (!githubIssueUrl?.trim()) {
        this.actor.send({ type: 'START', prompt });
        return;
      }

      const token = await resolveGitHubToken(this.config);
      if (!token) {
        this.callbacks.onError(
          'GitHub token not found. Set GITHUB_TOKEN, add github.token to pipeline.yaml, or run "gh auth login".',
        );
        return;
      }

      const issueContext = await fetchGitHubIssueContext(
        parseGitHubIssueUrl(githubIssueUrl),
        token,
      );
      this.githubIssueContext = issueContext;
      this.githubToken = token;
      this.actor.send({ type: 'START', prompt: buildGitHubIssuePrompt(issueContext, prompt) });
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  private _handleGithubReport(stateValue: string, context: PipelineContext): void {
    if (
      stateValue !== 'complete' &&
      stateValue !== 'failed' &&
      stateValue !== 'cancelled'
    ) {
      return;
    }

    const issueContext = this.githubIssueContext;
    const token = this.githubToken;
    if (!issueContext || !token) {
      return;
    }

    const runKey = `${context.pipelineId}:${stateValue}`;
    if (this.reportedRunKey === runKey) {
      return;
    }
    this.reportedRunKey = runKey;

    const result = buildHeadlessResultFromContext(stateValue, context, this.specContent);
    void postGitHubIssueComment(
      issueContext.ref,
      token,
      buildGitHubReport(result, issueContext),
    ).then((report) => {
      this.callbacks.onGithubReport?.(report);
    });
  }

  private _runStageIfNeeded(stateValue: string, context: PipelineContext): void {
    if (
      stateValue !== 'specifying' &&
      stateValue !== 'reviewing' &&
      stateValue !== 'specAssessing' &&
      stateValue !== 'executing' &&
      stateValue !== 'codeAssessing' &&
      stateValue !== 'fixing' &&
      stateValue !== 'documenting'
    ) {
      this.activeRunKey = null;
      return;
    }

    const runKey = `${stateValue}:${context.pipelineId}:${context.iteration}:${context.specQaIterations}:${context.codeQaIterations}`;
    if (this.activeRunKey === runKey) {
      return;
    }
    this.activeRunKey = runKey;

    // Cancel any previous run
    this.cancelCurrentRun?.();

    const stage: StageName = resolveAgentStage(stateValue);
    const assignment = this.agents[stage];
    const adapter = createAdapter(assignmentToAdapterConfig(assignment, this.config.ollama.host));

    let cancelled = false;
    this.cancelCurrentRun = () => {
      cancelled = true;
      adapter.cancel();
    };

    // Reset output for this stage
    if (stage === 'execute' && stateValue !== 'fixing') {
      this.callbacks.onTestProgress([]);
    }

    const send = this.actor.send.bind(this.actor);
    const specContentRef = { current: this.specContent };
    const reviewedSpecRef = { current: this.reviewedSpecContent };

    void (async () => {
      try {
        assertAdapterInstalled(assignment, this.detection);

        const prompt = await buildPromptForState({
          stateValue,
          context,
          config: this.config,
          latestSpecContent: specContentRef.current,
          latestReviewedSpecContent: reviewedSpecRef.current,
        });

        const startedAt = Date.now();
        const executionOutputDir =
          stateValue === 'executing'
            ? await prepareExecutionOutputDir(
                this.config.outputDir,
                context.prompt,
                context.pipelineId,
              )
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
          this.callbacks.onStreamChunk(chunk);

          if (stateValue === 'executing' || stateValue === 'fixing') {
            this.callbacks.onTestProgress(parseExecutionProgress(output));
          }
        }

        if (cancelled) {
          return;
        }

        await this.saveStageMarkdown(context, stateValue, stage, output);

        if (stage === 'spec') {
          this.specContent = output.trim();
          send({
            type: 'SPEC_COMPLETE',
            spec: createSpec(this.specContent, context.iteration),
          });
          return;
        }

        if (stage === 'review') {
          const previousReviewedSpec = this.reviewedSpecContent;
          const parsed = parseReviewOutput(output, context.iteration, context.iteration);
          this.reviewedSpecContent = parsed.reviewedSpec.content;
          // previousReviewedSpec is available for callers that need it via onStateChange
          void previousReviewedSpec;
          send({
            type: 'REVIEW_COMPLETE',
            reviewedSpec: parsed.reviewedSpec,
            score: parsed.score,
          });
          return;
        }

        if (stateValue === 'specAssessing') {
          const assessment = parseQaOutput(output, 'spec', Date.now() - startedAt);
          send({
            type: 'SPEC_QA_COMPLETE',
            assessment,
            maxReached:
              context.specQaIterations + 1 >= this.config.quality.maxSpecQaIterations,
          });
          return;
        }

        if (stateValue === 'codeAssessing') {
          const assessment = parseQaOutput(output, 'code', Date.now() - startedAt);
          send({
            type: 'CODE_QA_COMPLETE',
            assessment,
            maxReached:
              context.codeQaIterations + 1 >= this.config.quality.maxCodeQaIterations,
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
          stageWorkspace ?? this.config.outputDir,
          output,
          Date.now() - startedAt,
        );
        this.callbacks.onTestProgress(parseExecutionProgress(output));
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
  }

  private async saveStageMarkdown(
    context: PipelineContext,
    stateValue: string,
    stage: StageName,
    output: string,
  ): Promise<void> {
    try {
      const filePath = await saveStageMarkdown({
        outputRoot: this.config.outputDir,
        pipelineId: context.pipelineId,
        iteration: context.iteration,
        stage: stateValue,
        title: `${stage} output`,
        content: output,
      });
      this.callbacks.onMarkdownFile?.(filePath);
    } catch {
      // Markdown artifacts are best-effort and should not fail generation.
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (extracted from App.tsx, identical logic)
// ---------------------------------------------------------------------------

export function resolveAgentStage(stateValue: string): StageName {
  if (stateValue === 'specifying') return 'spec';
  if (stateValue === 'reviewing') return 'review';
  if (stateValue === 'specAssessing' || stateValue === 'codeAssessing') return 'qa';
  if (stateValue === 'documenting') return 'docs';
  return 'execute';
}

export async function buildPromptForState({
  stateValue,
  context,
  config,
  latestSpecContent,
  latestReviewedSpecContent,
}: {
  stateValue: string;
  context: PipelineContext;
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
    return buildCodeQaPrompt(latestReviewedSpecContent, context.executionResult, snapshot);
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

export async function resolveWorkspaceForState({
  stateValue,
  stage,
  context,
  executionOutputDir,
}: {
  stateValue: string;
  stage: StageName;
  context: PipelineContext;
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

export function qaAssessmentToFeedback(assessment: {
  summary: string;
  findings: string[];
  requiredChanges: string[];
}): string {
  return [
    assessment.summary,
    ...assessment.findings.map((finding) => `FINDING: ${finding}`),
    ...assessment.requiredChanges.map((change) => `REQUIRED_CHANGE: ${change}`),
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildHeadlessResultFromContext(
  stateValue: string,
  context: PipelineContext,
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
