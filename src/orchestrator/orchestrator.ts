// src/orchestrator/orchestrator.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentAdapter, AdapterConfig } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { AdapterDefaultsMap, AgentConsensusConfig, CrossReviewConfig, EvidenceConfig } from '../types/config.js';
import type { CrossReviewLedger, CrossReviewParticipant, DAGPlan, DAGStep, StepResult, StepStatus } from '../types/dag.js';
import { getReadySteps } from '../types/dag.js';
import { createToolRegistry } from '../tools/registry.js';
import { injectToolCatalog } from '../tools/inject.js';
import { runWithFailover } from '../adapters/failover-runner.js';
import type { VerboseReporter } from '../utils/verbose-reporter.js';
import { runSecurityGate } from '../security/gate.js';
import type { SecurityConfig } from '../security/types.js';
import { shouldGateStep } from '../security/should-gate.js';
import { isAbortError } from '../utils/error.js';
import { recordLearningCandidate } from '../knowledge/index.js';
import { normalizeTerminalText } from '../utils/terminal-text.js';
import { applyAdviserWorkflow, parseAdviserWorkflow, type AdviserReplanEvent } from '../adviser/workflow.js';
import { maybeScheduleGrammarReview } from './grammar-review.js';
import { maybeScheduleFactCheck } from './fact-check.js';
import { appendSecurityRemediationContext, buildSecurityRemediationContext } from './security-remediation.js';
import { validateStepHandoff } from './handoff-validation.js';
import { runFileConsensusInWorktrees } from './file-consensus.js';
import { runEvidenceGate } from './evidence-gate.js';
import { writeEvidenceSourceSnapshots } from './evidence-snapshots.js';
import {
  buildCrossReviewJudgeStep,
  buildCrossReviewReviewStep,
  buildCrossReviewRevisionStep,
  parseCrossReviewJudgeDecision,
  resolveCrossReviewModelOverrides,
  selectCrossReviewJudgeSelection,
  selectCrossReviewReviewerAgent,
  shouldCrossReviewStep,
  isCrossReviewHelperStep,
} from './cross-review.js';

export interface DAGExecutionResult {
  success: boolean;
  steps: StepResult[];
  plan: DAGPlan;
  replans?: AdviserReplanEvent[];
}

type AdapterFactory = (config: AdapterConfig) => AgentAdapter;

export interface DAGSecurityOptions {
  config: SecurityConfig;
  createReviewAdapter?: () => AgentAdapter;
}

export interface DAGRetryOptions {
  stepTimeoutMs?: number;
  maxStepRetries?: number;
  retryDelayMs?: number;
  adapterDefaults?: AdapterDefaultsMap;
  workingDir?: string;
  knowledgeCwd?: string;
  workspaceInstruction?: string;
  adaptiveReplanning?: {
    enabled?: boolean;
    refreshAgents?: () => Promise<Map<string, AgentDefinition>> | Map<string, AgentDefinition>;
  };
  handoffValidation?: {
    reviewedSpecContent?: string;
  };
  agentConsensus?: AgentConsensusConfig;
  evidence?: EvidenceConfig;
  crossReview?: CrossReviewConfig;
  localModelConcurrency?: number;
}

const MAX_TOOL_CALLS = 4;
const MAX_RECOVERY_ROUNDS = 2;
const DEFAULT_STEP_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_STEP_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 3_000;
const ADAPTIVE_TIMEOUTS_PATH = path.join('.map', 'adaptive-timeouts.json');
const CROSS_REVIEW_DEGRADED_INDEPENDENCE_RISK =
  'Cross-review judge independence degraded because no distinct judge agent was available.';

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message.toLowerCase();
  // Don't retry security failures, dependency failures, or cancellations
  if (msg.includes('security gate failed')) return false;
  if (msg.includes('dependency failed')) return false;
  if (msg.includes('execution cancelled')) return false;
  // Timeouts ARE retryable - we want to give the system more time on retry attempts
  if (!msg.includes('timed out') && !msg.includes('timeout')) return true;
  return true; // Allow timeout retries (see code around line 172 for dynamic timeout increase)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export async function executeDAG(
  plan: DAGPlan,
  agents: Map<string, AgentDefinition>,
  createAdapter: AdapterFactory,
  reporter?: VerboseReporter,
  security?: DAGSecurityOptions,
  signal?: AbortSignal,
  onOutputChunk?: (stepId: string, chunk: string) => void,
  retry?: DAGRetryOptions,
): Promise<DAGExecutionResult> {
  const mutablePlan: DAGPlan = {
    plan: plan.plan.map((step) => ({ ...step, dependsOn: [...step.dependsOn] })),
  };
  const configuredMaxRetries = retry?.maxStepRetries;
  const maxRetries = configuredMaxRetries ?? DEFAULT_MAX_STEP_RETRIES;
  const retryDelayMs = retry?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const stepTimeoutMs = retry?.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const adapterDefaults = retry?.adapterDefaults;
  const agentConsensus = retry?.agentConsensus;
  const crossReview = retry?.crossReview;
  const localModelConcurrency = Math.max(1, Math.floor(retry?.localModelConcurrency ?? 1));
  const workingDir = retry?.workingDir ?? process.cwd();
  const knowledgeCwd = retry?.knowledgeCwd ?? process.cwd();
  const workspaceInstruction = retry?.workspaceInstruction?.trim();
  const results = new Map<string, StepResult>();
  const completed = new Set<string>();
  const settled = new Set<string>();
  const failed = new Set<string>();
  const running = new Set<string>();
  const allIds = new Set(mutablePlan.plan.map((s) => s.id));
  const activeAdapters = new Set<AgentAdapter>();
  const recoveryRounds = new Map<string, number>();
  const crossReviewRounds = new Map<string, number>();
  const replans: AdviserReplanEvent[] = [];
  const adaptiveTimeouts = await loadAdaptiveTimeouts(workingDir);

  const abortActiveAdapters = () => {
    for (const adapter of activeAdapters) {
      adapter.cancel();
    }
  };

  signal?.addEventListener('abort', abortActiveAdapters);

  try {
    while (settled.size < allIds.size) {
      if (signal?.aborted) {
        break;
      }

      // Mark steps whose dependencies failed as skipped. Runtime graph mutations can
      // insert recovery/retry steps after downstream nodes, so repeat until cascading
      // dependency failures are fully settled before deciding whether no work is ready.
      let markedSkipped: boolean;
      do {
        markedSkipped = false;
        for (const step of mutablePlan.plan) {
          if (settled.has(step.id) || running.has(step.id)) continue;
          const depFailed = step.dependsOn.some((dep) => failed.has(dep));
          if (depFailed) {
            const failedDeps = step.dependsOn.filter((dep) => failed.has(dep));
            const reason = `Dependency failed: ${failedDeps.join(', ')}`;
            results.set(step.id, {
              id: step.id,
              agent: step.agent,
              task: step.task,
              dependsOn: [...step.dependsOn],
              status: 'skipped',
              reason,
            });
            failed.add(step.id);
            settled.add(step.id);
            markedSkipped = true;
            reporter?.dagStepSkipped(step.id, reason);
          }
        }
      } while (markedSkipped);

      const ready = getReadySteps(mutablePlan, completed).filter(
        (s) => !running.has(s.id) && !settled.has(s.id),
      );

      if (ready.length === 0) break;

      const scheduledReady = scheduleReadySteps(ready, agents, localModelConcurrency);

      const executions = scheduledReady.map(async (step) => {
        if (signal?.aborted) {
          return;
        }

        running.add(step.id);
        const agent = agents.get(step.agent)!;
        const stepAdapter = step.adapter ?? agent.adapter;
        const stepModel = step.model ?? agent.model;
        const startedAt = Date.now();
        reporter?.dagStepStart(step.id, step.agent, step.task);

        let lastError: string | undefined;
        let attempts = 0;
        let stepTimedOut = false;
        let timeoutMsForAttempt = Math.max(stepTimeoutMs, adaptiveTimeouts.get(step.agent) ?? 0);
        let sawTimeoutBeforeSuccess = false;
        let errorRetries = 0;
        let securityRemediationRetries = 0;
        let securityRemediationContext: string | undefined;
        let evidenceRemediationRetries = 0;
        let evidenceRemediationContext: string | undefined;
        let fileOutputRemediationRetries = 0;
        let fileOutputRemediationContext: string | undefined;

        while (true) {
          if (signal?.aborted) break;
          attempts += 1;
          stepTimedOut = false;

          if (attempts > 1) {
            reporter?.dagStepRetry(step.id, step.agent, attempts - 1, lastError ?? 'unknown');
            await delay(retryDelayMs, signal);
            if (signal?.aborted) break;
          }

          try {
            const baseContext = buildStepContext(step.task, step.dependsOn, results);
            const workspaceAwareContext = workspaceInstruction
              ? `${workspaceInstruction}\n\n${baseContext}`
              : baseContext;
            const rawContext = appendSecurityRemediationContext(
              workspaceAwareContext,
              securityRemediationContext,
            );
            const evidenceAwareContext = evidenceRemediationContext
              ? `${rawContext}\n\n${evidenceRemediationContext}`
              : rawContext;
            const fullContext = fileOutputRemediationContext
              ? `${evidenceAwareContext}\n\n${fileOutputRemediationContext}`
              : evidenceAwareContext;

            const configs: AdapterConfig[] = [
              { type: stepAdapter, model: stepModel },
              ...(agent.fallbacks ?? []).map((fb) => ({
                type: fb.adapter,
                model: fb.model,
              })),
            ];

            // Per-step timeout: create a child AbortController that aborts
            // when either the parent signal fires or the step makes no progress
            // for the configured timeout window. This is intentionally an
            // inactivity timeout rather than a hard wall-clock cap so long
            // local-model responses can keep running while they stream output.
            const stepController = new AbortController();
            let stepTimer: ReturnType<typeof setTimeout> | undefined;
            const abortFromParent = () => stepController.abort();
            signal?.addEventListener('abort', abortFromParent, { once: true });
            const consensusConfig = resolveAgentConsensus(agent, agentConsensus);
            const fileConsensusConfig = resolveFileOutputConsensus(agent, agentConsensus);
            const currentBaseTimeoutMs = timeoutMsForAttempt;
            const currentTimeoutMs =
              currentBaseTimeoutMs * (fileConsensusConfig?.runs ?? consensusConfig?.runs ?? 1);
            const armStepTimer = () => {
              if (stepTimer !== undefined) clearTimeout(stepTimer);
              if (currentTimeoutMs <= 0) return;
              stepTimer = setTimeout(() => {
                stepTimedOut = true;
                stepController.abort();
              }, currentTimeoutMs);
            };
            armStepTimer();

            // Resolve thinking: agent-level > adapter-default > undefined
            const resolvedThink = agent.think ?? adapterDefaults?.[stepAdapter]?.think;
            const resolvedTemperature = adapterDefaults?.[stepAdapter]?.temperature;
            const resolvedSeed = adapterDefaults?.[stepAdapter]?.seed;
            const workspaceBefore = agent.output.type === 'files'
              ? await captureWorkspaceSnapshot(workingDir)
              : null;
            const runOnce = (candidateWorkingDir: string, seedOffset = 0) => {
              const tools = createToolRegistry(agent, candidateWorkingDir);
              const context = injectToolCatalog(fullContext, tools, agent.prompt);
              return runStepWithTools({
                context,
                tools,
                configs,
                createAdapter,
                stepId: step.id,
                onOutputChunk,
                reporter,
                activeAdapters,
                stepController,
                signal,
                resolvedThink,
                resolvedTemperature,
                resolvedSeed: resolvedSeed !== undefined ? resolvedSeed + seedOffset : undefined,
                workingDir: candidateWorkingDir,
                onProgress: armStepTimer,
              });
            };

            let output: string;
            let consensusSelection: ConsensusSelection | undefined;
            try {
              if (fileConsensusConfig) {
                const fileConsensus = await runFileConsensusInWorktrees({
                  workingDir,
                  stepId: step.id,
                  config: fileConsensusConfig,
                  provider: stepAdapter,
                  model: stepModel,
                  runCandidate: (candidateWorkingDir, candidateIndex) =>
                    runOnce(candidateWorkingDir, candidateIndex),
                });
                consensusSelection = {
                  output: fileConsensus.output,
                  metadata: fileConsensus.metadata,
                };
                output = fileConsensus.output;
              } else if (consensusConfig) {
                const candidates: string[] = [];
                for (let candidateIndex = 0; candidateIndex < consensusConfig.runs; candidateIndex += 1) {
                  candidates.push(await runOnce(workingDir, candidateIndex));
                }
                consensusSelection = selectConsensusOutput(candidates, consensusConfig, agent);
                output = consensusSelection.output;
              } else {
                output = await runOnce(workingDir);
              }
            } finally {
              if (stepTimer !== undefined) clearTimeout(stepTimer);
              signal?.removeEventListener('abort', abortFromParent);
            }

            const changedFiles = workspaceBefore
              ? await diffWorkspaceSnapshot(workingDir, workspaceBefore)
              : [];
            const duration = Date.now() - startedAt;
            if (sawTimeoutBeforeSuccess && currentBaseTimeoutMs > (adaptiveTimeouts.get(step.agent) ?? 0)) {
              adaptiveTimeouts.set(step.agent, currentBaseTimeoutMs);
              await saveAdaptiveTimeouts(workingDir, adaptiveTimeouts);
            }
            const scheduledMetadata = results.get(step.id);
            const result: StepResult = {
              id: step.id,
              agent: step.agent,
              provider: stepAdapter,
              model: stepModel,
              task: step.task,
              dependsOn: [...step.dependsOn],
              status: 'completed',
              outputType: agent.output.type,
              output: normalizeTerminalText(output),
              duration,
              attempts,
              ...(step.parentStepId
                ? {
                    parentStepId: step.parentStepId,
                    edgeType: scheduledMetadata?.edgeType ?? ('handoff' as const),
                  }
                : {}),
              ...(scheduledMetadata?.spawnedByAgent ? { spawnedByAgent: scheduledMetadata.spawnedByAgent } : {}),
              ...(scheduledMetadata?.failureKind ? { failureKind: scheduledMetadata.failureKind } : {}),
              ...(changedFiles.length > 0 ? { filesCreated: changedFiles } : {}),
              ...(consensusSelection ? { consensus: consensusSelection.metadata } : {}),
            };

            if (security && shouldGateStep(agent) && !isCrossReviewHelperStep(step) && result.output) {
              reporter?.securityGateStart(step.id, step.agent);
              const securityStartedAt = Date.now();
              const securityResult = await runSecurityGate({
                content: result.output,
                agentName: step.agent,
                task: step.task,
                config: security.config,
                createReviewAdapter:
                  security.createReviewAdapter ??
                  (() =>
                    createAdapter({
                      type: security.config.adapter,
                      model: security.config.model,
                    })),
              });

              if (!securityResult.passed) {
                lastError = `Security gate failed with ${securityResult.findings.length} finding${securityResult.findings.length === 1 ? '' : 's'}`;
                securityRemediationContext = buildSecurityRemediationContext(
                  securityResult.findings,
                  output,
                );
                reporter?.securityGateFailed(step.id, securityResult.findings.length);

                if (securityRemediationRetries < security.config.maxRemediationRetries) {
                  securityRemediationRetries += 1;
                  continue;
                }

                results.set(step.id, {
                  ...result,
                  status: 'failed',
                  securityPassed: false,
                  securityFindings: securityResult.findings,
                  error: lastError,
                });
                failed.add(step.id);
                settled.add(step.id);
                break;
              }

              result.securityPassed = true;
              result.securityFindings = securityResult.findings;
              reporter?.securityGatePassed(step.id, Date.now() - securityStartedAt);
            }

            const evidenceGate = isCrossReviewHelperStep(step)
              ? { checked: false, passed: true, claims: [], findings: [] }
              : runEvidenceGate({ step, result, config: retry?.evidence });
            result.evidenceGate = evidenceGate;
            result.evidenceClaims = evidenceGate.claims;
            await writeEvidenceSourceSnapshots(workingDir, step, result);
            if (evidenceGate.checked && !evidenceGate.passed) {
              const evidenceError = formatEvidenceGateError(evidenceGate);
              if (evidenceRemediationRetries < (retry?.evidence?.remediationMaxRetries ?? 0)) {
                evidenceRemediationRetries += 1;
                lastError = evidenceError;
                evidenceRemediationContext = buildEvidenceRemediationContext(result, evidenceGate);
                continue;
              }
              const failedResult: StepResult = {
                ...result,
                status: 'failed',
                error: evidenceError,
                failureKind: 'evidence',
              };
              const recoveryCreated = maybeScheduleEvidenceFeedbackRecovery({
                step,
                failure: failedResult,
                plan: mutablePlan,
                allIds,
                agents,
                results,
                settled,
                recoveryRounds,
                reporter,
              });
              results.set(step.id, recoveryCreated.result);
              settled.add(step.id);
              if (!recoveryCreated.scheduled) {
                failed.add(step.id);
                reporter?.dagStepFailed(step.id, step.agent, evidenceError);
              }
              break;
            }

            const handoffValidation = validateStepHandoff({
              step,
              result,
              priorResults: results,
              reviewedSpecContent: retry?.handoffValidation?.reviewedSpecContent,
            });
            if (shouldRetryEmptyFileOutput(agent, result, handoffValidation) && fileOutputRemediationRetries < 1) {
              fileOutputRemediationRetries += 1;
              lastError = 'file-output step completed without usable output or file evidence';
              fileOutputRemediationContext = buildFileOutputRemediationContext(step, result);
              continue;
            }
            result.handoffPassed = handoffValidation.handoffPassed;
            result.handoffFindings = handoffValidation.handoffFindings;
            result.specConformance = handoffValidation.specConformance;

            results.set(step.id, result);
            if (!handoffValidation.handoffPassed) {
              result.status = 'failed';
              result.error = handoffValidation.handoffFindings
                .filter((finding) => finding.severity === 'high')
                .map((finding) => finding.message)
                .join('; ') || 'Handoff validation failed';
              failed.add(step.id);
              settled.add(step.id);
              reporter?.dagStepFailed(step.id, step.agent, result.error);
              break;
            }

            completed.add(step.id);
            settled.add(step.id);
            if (retry?.adaptiveReplanning?.enabled && step.agent === 'adviser') {
              const replan = await maybeApplyAdviserWorkflow({
                adviserStepId: step.id,
                output: result.output ?? '',
                plan: mutablePlan,
                agents,
                completed,
                settled,
                running,
                allIds,
                reporter,
                refreshAgents: retry.adaptiveReplanning.refreshAgents,
              });
              if (replan) {
                replans.push(replan);
                for (const insertedStepId of replan.insertedSteps) {
                  const insertedStep = mutablePlan.plan.find((candidate) => candidate.id === insertedStepId);
                  reporter?.agentDecision?.({
                    by: `${step.id} [${step.agent}]`,
                    agent: insertedStep?.agent ?? insertedStepId,
                    decision: 'added',
                    stepId: insertedStepId,
                    reason: `adviser replan inserted ${insertedStepId}`,
                  });
                }
                if (replan.insertedSteps.length === 0) {
                  reporter?.agentDecision?.({
                    by: `${step.id} [${step.agent}]`,
                    agent: 'additional-agent',
                    decision: 'not-needed',
                    reason: 'adviser replan did not insert any new steps',
                  });
                }
              } else {
                reporter?.agentDecision?.({
                  by: `${step.id} [${step.agent}]`,
                  agent: 'additional-agent',
                  decision: 'not-needed',
                  reason: 'adviser output did not request a workflow change',
                });
              }
            }
            maybeScheduleCrossReviewRevision({
              step,
              result,
              plan: mutablePlan,
              allIds,
              agents,
              results,
              settled,
              crossReview,
              reporter,
            });
            maybeScheduleCrossReviewGate({
              step,
              result,
              agent,
              plan: mutablePlan,
              allIds,
              agents,
              results,
              settled,
              crossReview,
              crossReviewRounds,
              reporter,
            });
            maybeScheduleFactCheck({
              step,
              result,
              plan: mutablePlan,
              allIds,
              agents,
              results,
              settled,
              reporter,
            });
            maybeScheduleGrammarReview({
              step,
              result,
              plan: mutablePlan,
              allIds,
              agents,
              results,
              settled,
              reporter,
            });
            if (step.agent === 'result-judge' && result.output?.trim()) {
              await persistLearningCandidate(step, result.output, knowledgeCwd);
            }
            reporter?.dagStepOutput(step.id, step.agent, result.output ?? '');
            reporter?.dagStepComplete(step.id, step.agent, duration);
            lastError = undefined;
            break; // Success - exit retry loop
          } catch (err: unknown) {
            if (isAbortError(err)) {
              lastError = signal?.aborted
                ? 'Execution cancelled'
                : stepTimedOut
                  ? `Step timed out during ${step.id} (${step.agent})`
                  : `Operation aborted during ${step.id} (${step.agent})`;
            } else {
              lastError = err instanceof Error ? err.message : String(err);
            }
            if (stepTimedOut) {
              sawTimeoutBeforeSuccess = true;
              timeoutMsForAttempt *= 2;
            }
            const retryBudget = stepTimedOut
              ? (configuredMaxRetries ?? DEFAULT_MAX_STEP_RETRIES)
              : (configuredMaxRetries ?? 0);
            if (!isRetryable(err) || errorRetries >= retryBudget) {
              const duration = Date.now() - startedAt;
              const baseFailure: StepResult = {
                id: step.id,
                agent: step.agent,
                provider: agent.adapter,
                model: agent.model,
                task: step.task,
                dependsOn: [...step.dependsOn],
                status: 'failed',
                error: lastError,
                duration,
                attempts,
                failureKind: classifyFailure(lastError),
              };
              const recoveryCreated = stepTimedOut
                ? { scheduled: false, result: baseFailure }
                : maybeScheduleRecovery({
                    step,
                    failure: baseFailure,
                    plan: mutablePlan,
                    allIds,
                    agents,
                    results,
                    settled,
                    recoveryRounds,
                    reporter,
                  });
              results.set(step.id, recoveryCreated.result);
              settled.add(step.id);
              if (!recoveryCreated.scheduled) {
                failed.add(step.id);
                reporter?.dagStepFailed(step.id, step.agent, lastError);
              }
              break; // Non-retryable or retries exhausted - exit retry loop
            }
            errorRetries += 1;
          }
        }

        running.delete(step.id);
      });

      await Promise.all(executions);
    }
  } finally {
    signal?.removeEventListener('abort', abortActiveAdapters);
  }

  const stepResults = mutablePlan.plan.map(
    (step) =>
      results.get(step.id) ?? {
        id: step.id,
        agent: step.agent,
        task: step.task,
        dependsOn: [...step.dependsOn],
        status: 'pending' as StepStatus,
        provider: agents.get(step.agent)?.adapter,
        model: agents.get(step.agent)?.model,
      },
  );

  for (const result of stepResults) {
    if (result.status !== 'failed' || !result.replacementStepId) continue;
    const replacement = results.get(result.replacementStepId);
      if (replacement?.status === 'completed') {
        result.status = 'recovered';
        failed.delete(result.id);
        void persistLearningCandidate(
          {
            id: result.id,
            agent: result.agent,
            task: result.task,
          },
          `Recovered failure: ${result.error ?? 'unknown'}\nReplacement step: ${result.replacementStepId}`,
          knowledgeCwd,
        );
      }
    }

  return {
    success: failed.size === 0,
    steps: stepResults,
    plan: mutablePlan,
    ...(replans.length > 0 ? { replans } : {}),
  };
}


function shouldRetryEmptyFileOutput(
  agent: AgentDefinition,
  result: StepResult,
  handoffValidation: ReturnType<typeof validateStepHandoff>,
): boolean {
  if (agent.output.type !== 'files') return false;
  if (result.output?.trim()) return false;
  return handoffValidation.handoffFindings.some((finding) =>
    finding.severity === 'high' && finding.message.includes('file-output step completed without usable output'),
  );
}

function buildFileOutputRemediationContext(step: DAGStep, result: StepResult): string {
  return [
    '--- File-Output Remediation Required ---',
    'Your previous file-output response was empty or did not provide usable file evidence.',
    'You must create or modify files in the workspace using the available tools, then report changed files and verification evidence.',
    'If you are blocked from editing files, return a concrete blocker with the exact missing information, command failure, or missing authority.',
    '',
    `Original step: ${step.id}`,
    `Original task: ${step.task}`,
    '',
    'Previous output:',
    result.output?.trim() || '(empty)',
  ].join('\n');
}

function formatEvidenceGateError(
  evidenceGate: NonNullable<StepResult['evidenceGate']>,
): string {
  return evidenceGate.findings
    .filter((finding) => finding.severity === 'high')
    .map((finding) => finding.claimId ? `${finding.claimId}: ${finding.message}` : finding.message)
    .join('; ') || 'Evidence gate failed';
}

function buildEvidenceRemediationContext(
  result: StepResult,
  evidenceGate: NonNullable<StepResult['evidenceGate']>,
): string {
  return [
    '--- Evidence Gate Remediation Required ---',
    'Your previous output failed deterministic evidence validation.',
    'Revise the output and Claim Evidence Ledger. Do not invent evidence.',
    'Allowed fixes: add direct evidence, downgrade confidence, change timeframe, lower commonness score, mark unavailable, or remove unsupported claims.',
    '',
    'Evidence findings:',
    ...evidenceGate.findings.map((finding) =>
      `- ${finding.severity}${finding.claimId ? ` ${finding.claimId}` : ''}: ${finding.message}`,
    ),
    '',
    'Previous output:',
    result.output ?? '',
  ].join('\n');
}

interface AdviserWorkflowOptions {
  adviserStepId: string;
  output: string;
  plan: DAGPlan;
  agents: Map<string, AgentDefinition>;
  completed: Set<string>;
  settled: Set<string>;
  running: Set<string>;
  allIds: Set<string>;
  refreshAgents?: () => Promise<Map<string, AgentDefinition>> | Map<string, AgentDefinition>;
  reporter?: VerboseReporter;
}

async function maybeApplyAdviserWorkflow(
  options: AdviserWorkflowOptions,
): Promise<AdviserReplanEvent | null> {
  const workflow = parseAdviserWorkflow(options.output);
  if (!workflow) return null;

  const refreshedAgents =
    workflow.refreshAgents && options.refreshAgents
      ? await options.refreshAgents()
      : null;
  const agentSource = refreshedAgents ?? options.agents;

  let event: AdviserReplanEvent;
  try {
    event = applyAdviserWorkflow({
      adviserStepId: options.adviserStepId,
      workflow,
      plan: options.plan,
      agents: agentSource,
      completed: options.completed,
      settled: options.settled,
      running: options.running,
      allIds: options.allIds,
      refreshedAgents: refreshedAgents !== null,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    options.reporter?.agentDecision?.({
      by: `${options.adviserStepId} [adviser]`,
      agent: 'additional-agent',
      decision: 'not-needed',
      reason: `adviser workflow ignored because ${reason}`,
    });
    return null;
  }

  if (refreshedAgents) {
    options.agents.clear();
    for (const [name, agentDefinition] of refreshedAgents) {
      options.agents.set(name, agentDefinition);
    }
  }

  return event;
}

async function persistLearningCandidate(
  step: Pick<DAGPlan['plan'][number], 'id' | 'agent' | 'task'>,
  output: string,
  knowledgeCwd: string,
): Promise<void> {
  try {
    await recordLearningCandidate({
      cwd: knowledgeCwd,
      title: `${step.agent} lesson from ${step.id}`,
      lesson: output,
      sourceTask: step.task,
      confidence: 'medium',
      freshnessHint: 'medium',
    });
  } catch {
    // Learning writeback is best-effort.
  }
}

interface CrossReviewGateOptions {
  step: DAGStep;
  result: StepResult;
  agent: AgentDefinition;
  plan: DAGPlan;
  allIds: Set<string>;
  agents: Map<string, AgentDefinition>;
  results: Map<string, StepResult>;
  settled: Set<string>;
  crossReview?: CrossReviewConfig;
  crossReviewRounds: Map<string, number>;
  reporter?: VerboseReporter;
}

function maybeScheduleCrossReviewGate(options: CrossReviewGateOptions): void {
  const config = options.crossReview;
  if (!config || options.result.crossReview) return;

  const rootStepId = options.step.parentStepId ?? options.step.id;
  const round = (options.crossReviewRounds.get(rootStepId) ?? 0) + 1;
  const decision = shouldCrossReviewStep({
    config,
    step: options.step,
    result: options.result,
    agent: options.agent,
    round,
  });
  if (!decision.shouldReview) {
    return;
  }

  const reviewerAgent = selectCrossReviewReviewerAgent(options.step.agent, options.agents);
  if (!reviewerAgent) {
    options.reporter?.agentDecision?.({
      by: `${options.step.id} [${options.step.agent}]`,
      agent: 'cross-reviewer',
      decision: 'not-needed',
      reason: 'No enabled peer-review helper agent is available for cross-review.',
    });
    return;
  }
  const judgeSelection = selectCrossReviewJudgeSelection(
    options.step.agent,
    reviewerAgent,
    options.agents,
    { preferSeparatePanel: config.judge.preferSeparatePanel },
  );
  const judgeAgent = judgeSelection.judgeAgent;
  const modelOverrides = resolveCrossReviewModelOverrides({
    config,
    reviewerAgent,
    judgeAgent,
    agents: options.agents,
  });
  const reviewStep = buildCrossReviewReviewStep({
    step: options.step,
    result: options.result,
    reviewerAgent,
    round,
    gate: decision.gate ?? 'unknown',
    override: modelOverrides.review,
  });
  const judgeStep = buildCrossReviewJudgeStep({
    step: options.step,
    result: options.result,
    reviewStepId: reviewStep.id,
    judgeAgent,
    round,
    gate: decision.gate ?? 'unknown',
    override: modelOverrides.judge,
  });

  if (options.allIds.has(reviewStep.id) || options.allIds.has(judgeStep.id)) return;

  options.crossReviewRounds.set(rootStepId, round);
  insertAfter(options.plan, options.step.id, [reviewStep, judgeStep]);
  options.allIds.add(reviewStep.id);
  options.allIds.add(judgeStep.id);
  appendDownstreamDependency(options.plan, options.step.id, judgeStep.id, new Set([
    options.step.id,
    reviewStep.id,
    judgeStep.id,
  ]), options.settled);

  const rootResult = options.results.get(rootStepId) ?? options.result;
  const existingLedger = rootResult.crossReview;
  const residualRisks = judgeSelection.degradedIndependence
    ? mergeUnique(existingLedger?.residualRisks ?? [], [CROSS_REVIEW_DEGRADED_INDEPENDENCE_RISK])
    : existingLedger?.residualRisks ?? [];
  const nextLedger: CrossReviewLedger = {
    rootStepId,
    round,
    gate: decision.gate ?? 'unknown',
    status: 'pending',
    participants: [
      crossReviewParticipant('proposer', options.step.agent, options.agents, {
        adapter: options.step.adapter,
        model: options.step.model,
      }),
      crossReviewParticipant('reviewer', reviewerAgent, options.agents, modelOverrides.review),
      crossReviewParticipant('judge', judgeAgent, options.agents, modelOverrides.judge),
    ],
    reviewStepId: reviewStep.id,
    judgeStepId: judgeStep.id,
    revisionStepId: existingLedger?.revisionStepId,
    residualRisks,
    budgetExhausted: false,
  };
  rootResult.crossReview = nextLedger;
  if (rootStepId === options.step.id) {
    options.result.crossReview = nextLedger;
  }
  options.results.set(rootStepId, rootResult);
  options.results.set(options.step.id, options.result);
  options.results.set(reviewStep.id, {
    id: reviewStep.id,
    agent: reviewStep.agent,
    provider: reviewStep.adapter ?? options.agents.get(reviewStep.agent)?.adapter,
    model: reviewStep.model ?? options.agents.get(reviewStep.agent)?.model,
    task: reviewStep.task,
    dependsOn: [...reviewStep.dependsOn],
    status: 'pending',
    parentStepId: rootStepId,
    edgeType: 'review',
    spawnedByAgent: options.step.agent,
  });
  options.results.set(judgeStep.id, {
    id: judgeStep.id,
    agent: judgeStep.agent,
    provider: judgeStep.adapter ?? options.agents.get(judgeStep.agent)?.adapter,
    model: judgeStep.model ?? options.agents.get(judgeStep.agent)?.model,
    task: judgeStep.task,
    dependsOn: [...judgeStep.dependsOn],
    status: 'pending',
    parentStepId: rootStepId,
    edgeType: 'judge',
    spawnedByAgent: options.step.agent,
  });
  options.reporter?.agentDecision?.({
    by: `${options.step.id} [${options.step.agent}]`,
    agent: reviewerAgent,
    decision: 'added',
    stepId: reviewStep.id,
    reason: decision.reason,
  });
  options.reporter?.agentDecision?.({
    by: `${options.step.id} [${options.step.agent}]`,
    agent: judgeAgent,
    decision: 'added',
    stepId: judgeStep.id,
    reason: `cross-review judge scheduled for ${decision.gate ?? 'unknown'} gate`,
  });
}

interface CrossReviewRevisionOptions {
  step: DAGStep;
  result: StepResult;
  plan: DAGPlan;
  allIds: Set<string>;
  agents: Map<string, AgentDefinition>;
  results: Map<string, StepResult>;
  settled: Set<string>;
  crossReview?: CrossReviewConfig;
  reporter?: VerboseReporter;
}

function maybeScheduleCrossReviewRevision(options: CrossReviewRevisionOptions): void {
  if (!options.crossReview || !/-judge-\d+$/.test(options.step.id) || !options.step.parentStepId) {
    return;
  }

  const rootStepId = options.step.parentStepId;
  const sourceResult = options.results.get(rootStepId);
  const ledger = sourceResult?.crossReview;
  if (!sourceResult || !ledger || ledger.judgeStepId !== options.step.id) return;

  const decision = parseCrossReviewJudgeDecision(options.result.output ?? '');
  const preservedResidualRisks = ledger.residualRisks.filter(
    (risk) => risk === CROSS_REVIEW_DEGRADED_INDEPENDENCE_RISK,
  );
  ledger.judgeDecision = decision.decision;
  ledger.judgeRationale = decision.rationale;
  ledger.requestedRemediation = decision.remediation;
  ledger.residualRisks = mergeUnique(preservedResidualRisks, decision.residualRisks);
  ledger.critiqueSummary = summarizeCrossReviewCritique(
    ledger.reviewStepId ? options.results.get(ledger.reviewStepId)?.output : undefined,
  );
  const reportDecision = (reportedDecision: string, reason = decision.rationale): void => {
    options.reporter?.crossReviewDecision?.({
      stepId: rootStepId,
      gate: ledger.gate,
      decision: reportedDecision,
      round: ledger.round,
      reason: reason || 'No judge rationale provided.',
    });
  };

  if (decision.decision === 'accept') {
    ledger.status = 'accepted';
    ledger.budgetExhausted = false;
    reportDecision(decision.decision);
    options.results.set(rootStepId, sourceResult);
    return;
  }
  if (decision.decision === 'degraded') {
    ledger.status = 'degraded';
    ledger.budgetExhausted = false;
    reportDecision(decision.decision);
    options.results.set(rootStepId, sourceResult);
    return;
  }

  if (ledger.round >= options.crossReview.maxRounds) {
    ledger.status = 'budget-exhausted';
    ledger.budgetExhausted = true;
    reportDecision(
      'budget-exhausted',
      `${decision.rationale || 'Judge requested more review.'} Max cross-review rounds (${options.crossReview.maxRounds}) reached.`,
    );
    options.results.set(rootStepId, sourceResult);
    return;
  }

  const sourceStep = options.plan.plan.find((candidate) => candidate.id === rootStepId);
  if (!sourceStep) {
    ledger.status = 'degraded';
    ledger.budgetExhausted = false;
    ledger.residualRisks = [
      ...ledger.residualRisks,
      'Could not find the original source step to schedule a cross-review revision.',
    ];
    reportDecision('degraded', 'Could not find the original source step to schedule a cross-review revision.');
    options.results.set(rootStepId, sourceResult);
    return;
  }

  const revisionStep = buildCrossReviewRevisionStep({
    step: sourceStep,
    judgeStepId: options.step.id,
    round: ledger.round,
    remediation: decision.remediation,
  });
  if (options.allIds.has(revisionStep.id)) {
    reportDecision(decision.decision);
    options.results.set(rootStepId, sourceResult);
    return;
  }

  ledger.status = 'revision-requested';
  ledger.revisionStepId = revisionStep.id;
  ledger.budgetExhausted = false;
  reportDecision(decision.decision);
  insertAfter(options.plan, options.step.id, [revisionStep]);
  options.allIds.add(revisionStep.id);
  const reviewedContentStepId = contentDependencyForJudgeStep(options.step, ledger.reviewStepId) ?? rootStepId;
  rewireDownstreamToRevision(options.plan, {
    previousContentId: reviewedContentStepId,
    previousJudgeId: options.step.id,
    revisionId: revisionStep.id,
    excludeIds: new Set([
      rootStepId,
      ledger.reviewStepId ?? '',
      options.step.id,
      revisionStep.id,
    ]),
    settled: options.settled,
  });
  options.results.set(rootStepId, sourceResult);
  options.results.set(revisionStep.id, {
    id: revisionStep.id,
    agent: revisionStep.agent,
    task: revisionStep.task,
    dependsOn: [...revisionStep.dependsOn],
    status: 'pending',
    parentStepId: rootStepId,
    edgeType: 'feedback',
    spawnedByAgent: sourceStep.agent,
  });
}

function insertAfter(plan: DAGPlan, sourceId: string, steps: DAGStep[]): void {
  const sourceIndex = plan.plan.findIndex((candidate) => candidate.id === sourceId);
  if (sourceIndex === -1) {
    plan.plan.push(...steps);
    return;
  }
  plan.plan.splice(sourceIndex + 1, 0, ...steps);
}

function appendDownstreamDependency(
  plan: DAGPlan,
  fromId: string,
  dependencyId: string,
  excludeIds: Set<string>,
  settled: Set<string>,
): void {
  for (const candidate of plan.plan) {
    if (excludeIds.has(candidate.id) || settled.has(candidate.id)) continue;
    if (!candidate.dependsOn.includes(fromId)) continue;
    candidate.dependsOn = [...new Set([...candidate.dependsOn, dependencyId])];
  }
}

function rewireDownstreamToRevision(
  plan: DAGPlan,
  options: {
    previousContentId: string;
    previousJudgeId: string;
    revisionId: string;
    excludeIds: Set<string>;
    settled: Set<string>;
  },
): void {
  for (const candidate of plan.plan) {
    if (options.excludeIds.has(candidate.id) || options.settled.has(candidate.id)) continue;
    if (
      !candidate.dependsOn.includes(options.previousContentId) &&
      !candidate.dependsOn.includes(options.previousJudgeId)
    ) {
      continue;
    }
    const retainedDependencies = candidate.dependsOn.filter(
      (dep) => dep !== options.previousContentId && dep !== options.previousJudgeId,
    );
    candidate.dependsOn = [...new Set([...retainedDependencies, options.revisionId])];
  }
}

function contentDependencyForJudgeStep(
  judgeStep: DAGStep,
  reviewStepId: string | undefined,
): string | null {
  return judgeStep.dependsOn.find((dep) => dep !== reviewStepId) ?? null;
}

function crossReviewParticipant(
  role: CrossReviewParticipant['role'],
  agentName: string,
  agents: Map<string, AgentDefinition>,
  override: { adapter?: CrossReviewParticipant['provider']; model?: string } = {},
): CrossReviewParticipant {
  const agent = agents.get(agentName);
  return {
    role,
    agent: agentName,
    provider: override.adapter ?? agent?.adapter,
    model: override.model ?? agent?.model,
  };
}

function summarizeCrossReviewCritique(output: string | undefined): string | undefined {
  const normalized = output?.trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function mergeUnique(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
}

function scheduleReadySteps(
  ready: DAGPlan['plan'],
  agents: Map<string, AgentDefinition>,
  localModelConcurrency = 1,
): DAGPlan['plan'] {
  const remoteReady: DAGPlan['plan'] = [];
  const localGpuReady: DAGPlan['plan'] = [];

  for (const step of ready) {
    const agent = agents.get(step.agent);
    if ((step.adapter ?? agent?.adapter) === 'ollama') {
      localGpuReady.push(step);
    } else {
      remoteReady.push(step);
    }
  }

  if (localGpuReady.length === 0) {
    return remoteReady;
  }

  return [...remoteReady, ...localGpuReady.slice(0, Math.max(1, localModelConcurrency))];
}

interface ConsensusSelection {
  output: string;
  metadata: NonNullable<StepResult['consensus']>;
}

function resolveAgentConsensus(
  agent: AgentDefinition,
  config: AgentConsensusConfig | undefined,
): AgentConsensusConfig | null {
  if (!config) {
    return null;
  }
  const override = config.perAgent?.[agent.name];
  const resolved: AgentConsensusConfig = {
    ...config,
    ...(override ?? {}),
    outputTypes: override?.outputTypes ?? config.outputTypes,
    fileOutputs: config.fileOutputs,
    perAgent: config.perAgent,
  };

  if (!resolved.enabled || resolved.runs <= 1) {
    return null;
  }
  if (!resolved.outputTypes.includes(agent.output.type)) {
    return null;
  }
  return resolved;
}

function resolveFileOutputConsensus(
  agent: AgentDefinition,
  config: AgentConsensusConfig | undefined,
): AgentConsensusConfig['fileOutputs'] | null {
  if (!config?.enabled || !config.fileOutputs?.enabled || config.fileOutputs.runs <= 1) {
    return null;
  }
  if (agent.output.type !== 'files') {
    return null;
  }
  return config.fileOutputs;
}

function selectConsensusOutput(
  outputs: string[],
  config: AgentConsensusConfig,
  agent: AgentDefinition,
): ConsensusSelection {
  const normalized = outputs.map(normalizeConsensusText);
  const exactCounts = new Map<string, { count: number; firstIndex: number }>();

  normalized.forEach((output, index) => {
    const existing = exactCounts.get(output);
    if (existing) {
      existing.count += 1;
      return;
    }
    exactCounts.set(output, { count: 1, firstIndex: index });
  });

  const majority = [...exactCounts.values()]
    .filter((entry) => entry.count > outputs.length / 2)
    .sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex)[0];

  if (majority) {
    return {
      output: outputs[majority.firstIndex]!,
      metadata: {
        enabled: true,
        runs: config.runs,
        candidateCount: outputs.length,
        selectedRun: majority.firstIndex + 1,
        agreement: majority.count / outputs.length,
        method: 'exact-majority',
        participants: outputs.map((_output, index) => ({
          run: index + 1,
          provider: agent.adapter,
          model: agent.model,
          status: normalized[index] === normalized[majority.firstIndex] ? 'contributed' : 'rejected',
          contribution: normalized[index] === normalized[majority.firstIndex] ? 1 : 0,
        })),
      },
    };
  }

  const tokenSets = normalized.map((text) => new Set(tokenizeConsensusText(text)));
  let bestIndex = 0;
  let bestAgreement = -1;

  for (let index = 0; index < tokenSets.length; index += 1) {
    const comparisons = tokenSets
      .map((tokens, otherIndex) => otherIndex === index ? null : jaccard(tokenSets[index]!, tokens))
      .filter((score): score is number => score !== null);
    const agreement =
      comparisons.length > 0
        ? comparisons.reduce((sum, score) => sum + score, 0) / comparisons.length
        : 1;
    if (agreement > bestAgreement) {
      bestAgreement = agreement;
      bestIndex = index;
    }
  }

  if (bestAgreement < config.minSimilarity) {
    throw new Error(
      `Agent consensus failed: best agreement ${bestAgreement.toFixed(2)} below minimum ${config.minSimilarity.toFixed(2)}`,
    );
  }

  return {
    output: outputs[bestIndex]!,
    metadata: {
      enabled: true,
      runs: config.runs,
      candidateCount: outputs.length,
      selectedRun: bestIndex + 1,
      agreement: Math.max(0, bestAgreement),
      method: 'medoid-token-similarity',
      participants: outputs.map((_output, index) => ({
        run: index + 1,
        provider: agent.adapter,
        model: agent.model,
        status: index === bestIndex ? 'selected' : 'valid',
        contribution: jaccard(tokenSets[bestIndex]!, tokenSets[index]!),
      })),
    },
  };
}

function normalizeConsensusText(text: string): string {
  return normalizeTerminalText(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenizeConsensusText(text: string): string[] {
  return text
    .split(/[^a-z0-9._/-]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

async function loadAdaptiveTimeouts(workingDir: string): Promise<Map<string, number>> {
  try {
    const raw = await fs.readFile(path.join(workingDir, ADAPTIVE_TIMEOUTS_PATH), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return new Map();
    }

    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
      );
    return new Map(entries);
  } catch {
    return new Map();
  }
}

async function saveAdaptiveTimeouts(workingDir: string, timeouts: Map<string, number>): Promise<void> {
  const filePath = path.join(workingDir, ADAPTIVE_TIMEOUTS_PATH);
  const payload = Object.fromEntries(
    [...timeouts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

interface RunStepWithToolsOptions {
  context: string;
  tools: ReturnType<typeof createToolRegistry>;
  configs: AdapterConfig[];
  createAdapter: AdapterFactory;
  stepId: string;
  onOutputChunk?: (stepId: string, chunk: string) => void;
  reporter?: VerboseReporter;
  activeAdapters: Set<AgentAdapter>;
  stepController: AbortController;
  signal?: AbortSignal;
  resolvedThink?: boolean;
  resolvedTemperature?: number;
  resolvedSeed?: number;
  workingDir: string;
  onProgress?: () => void;
}

async function runStepWithTools(options: RunStepWithToolsOptions): Promise<string> {
  let prompt = options.context;
  const successfulToolResults = new Map<string, string>();

  for (let toolRound = 0; toolRound <= MAX_TOOL_CALLS; toolRound += 1) {
    const output = await runWithFailover(options.configs, options.createAdapter, async (adapter) => {
      options.activeAdapters.add(adapter);
      try {
        let out = '';
        for await (const chunk of adapter.run(
          prompt,
          {
            signal: options.stepController.signal,
            cwd: options.workingDir,
            ...(options.resolvedThink !== undefined
              ? { think: options.resolvedThink, hideThinking: !options.resolvedThink }
              : {}),
            ...(options.resolvedTemperature !== undefined
              ? { temperature: options.resolvedTemperature }
              : {}),
            ...(options.resolvedSeed !== undefined ? { seed: options.resolvedSeed } : {}),
          },
        )) {
          options.onProgress?.();
          out += chunk;
          options.reporter?.onChunk(chunk.length);
          options.onOutputChunk?.(options.stepId, chunk);
        }

        if (options.stepController.signal.aborted) {
          throw new Error(options.signal?.aborted ? 'Execution cancelled' : 'Step timed out');
        }

        return out.trim();
      } finally {
        options.activeAdapters.delete(adapter);
      }
    });

    const toolCall = extractToolCall(output);
    if (!toolCall) {
      return output;
    }

    const toolCallKey = stableToolCallKey(toolCall);
    const previousSuccessfulOutput = successfulToolResults.get(toolCallKey);
    if (previousSuccessfulOutput !== undefined) {
      return [
        `Tool ${toolCall.tool} already returned the same successful result for identical parameters.`,
        'Returning that result instead of repeating the tool call.',
        '',
        previousSuccessfulOutput,
      ].join('\n');
    }

    const tool = options.tools.find((candidate) => candidate.name === toolCall.tool);
    const toolResult = tool
      ? await tool.execute(toolCall.params)
      : { success: false, output: '', error: `Unknown tool "${toolCall.tool}"` };
    if (toolResult.success) {
      successfulToolResults.set(toolCallKey, toolResult.output);
    }

    prompt = [
      options.context,
      '',
      '--- Tool request ---',
      output,
      '',
      `Tool execution result for ${toolCall.tool}:`,
      toolResult.success ? toolResult.output : `ERROR: ${toolResult.error ?? 'Tool failed'}`,
      '',
      'Continue the task. If more tool use is required, emit one JSON tool call. Otherwise, return the final answer.',
    ].join('\n');
  }

  throw new Error(`Tool loop exceeded ${MAX_TOOL_CALLS} rounds`);
}


function stableToolCallKey(toolCall: { tool: string; params: Record<string, unknown> }): string {
  return `${toolCall.tool}:${stableJson(toolCall.params)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function extractToolCall(output: string): { tool: string; params: Record<string, unknown> } | null {
  const trimmed = normalizeTerminalText(output).trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim() ?? trimmed;
  const candidates = sliceJsonObjects(fenced);

  for (const candidate of candidates) {
    const parsed = parseToolCallCandidate(candidate);
    if (!parsed || typeof parsed.tool !== 'string') continue;
    return {
      tool: parsed.tool,
      params:
        parsed.params && typeof parsed.params === 'object'
          ? (parsed.params as Record<string, unknown>)
          : {},
    };
  }

  return null;
}

function parseToolCallCandidate(candidate: string): { tool?: unknown; params?: unknown } | null {
  try {
    return JSON.parse(candidate) as { tool?: unknown; params?: unknown };
  } catch {
    try {
      return JSON.parse(candidate.replace(/[\r\n]+/g, ' ')) as { tool?: unknown; params?: unknown };
    } catch {
      return null;
    }
  }
}

function sliceJsonObjects(text: string): string[] {
  const starts: number[] = [];
  const candidates: string[] = [];
  for (let index = text.indexOf('{'); index !== -1; index = text.indexOf('{', index + 1)) {
    starts.push(index);
  }

  for (let i = starts.length - 1; i >= 0; i -= 1) {
    const start = starts[i]!;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = start; cursor < text.length; cursor += 1) {
      const char = text[cursor]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, cursor + 1));
          break;
        }
      }
    }
  }

  return candidates;
}


type WorkspaceSnapshot = Map<string, string>;

const SNAPSHOT_EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.map', '.worktrees']);
const MAX_SNAPSHOT_FILES = 20_000;

async function captureWorkspaceSnapshot(rootDir: string): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = new Map();
  await visitWorkspaceFiles(rootDir, rootDir, snapshot);
  return snapshot;
}

async function diffWorkspaceSnapshot(rootDir: string, before: WorkspaceSnapshot): Promise<string[]> {
  const after = await captureWorkspaceSnapshot(rootDir);
  const changed: string[] = [];
  for (const [file, signature] of after.entries()) {
    if (before.get(file) !== signature) changed.push(file);
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changed.push(file);
  }
  return [...new Set(changed)].sort();
}

async function visitWorkspaceFiles(rootDir: string, currentDir: string, snapshot: WorkspaceSnapshot): Promise<void> {
  if (snapshot.size >= MAX_SNAPSHOT_FILES) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (snapshot.size >= MAX_SNAPSHOT_FILES) return;
    if (entry.name.startsWith('.') && SNAPSHOT_EXCLUDED_DIRS.has(entry.name)) continue;
    if (SNAPSHOT_EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      await visitWorkspaceFiles(rootDir, fullPath, snapshot);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const stat = await fs.stat(fullPath);
      snapshot.set(relativePath, `${stat.size}:${Math.trunc(stat.mtimeMs)}`);
    } catch {
      continue;
    }
  }
}

function classifyFailure(error?: string): StepResult['failureKind'] {
  const normalized = error?.toLowerCase() ?? '';
  if (/(timed out|timeout)/.test(normalized)) return 'timeout';
  if (/(test|assert|expect|vitest|jest)/.test(normalized)) return 'test';
  if (/(typescript|compile|compil|type error|cannot find name|ts\d+)/.test(normalized)) {
    return 'compile';
  }
  if (/(lint|eslint|prettier)/.test(normalized)) return 'lint';
  if (/(build|bundle|webpack|vite|rollup)/.test(normalized)) return 'build';
  if (/(toolchain|npm|pnpm|yarn|dependency)/.test(normalized)) return 'tooling';
  if (normalized.length > 0) return 'runtime';
  return 'unknown';
}

interface RecoveryOptions {
  step: DAGPlan['plan'][number];
  failure: StepResult;
  plan: DAGPlan;
  allIds: Set<string>;
  agents: Map<string, AgentDefinition>;
  results: Map<string, StepResult>;
  settled: Set<string>;
  recoveryRounds: Map<string, number>;
  reporter?: VerboseReporter;
}

function maybeScheduleEvidenceFeedbackRecovery(options: RecoveryOptions): {
  scheduled: boolean;
  result: StepResult;
} {
  const rootId = options.step.parentStepId ?? options.step.id;
  const round = (options.recoveryRounds.get(rootId) ?? 0) + 1;
  if (round > MAX_RECOVERY_ROUNDS) {
    options.reporter?.dagRecoveryUnavailable?.({
      stepId: options.step.id,
      failureKind: 'evidence',
      reason: `Recovery round limit (${MAX_RECOVERY_ROUNDS}) was reached for ${rootId}.`,
    });
    return {
      scheduled: false,
      result: {
        ...options.failure,
        blockerKind: 'no-progress',
      },
    };
  }

  const helperAgent = selectEvidenceFeedbackAgent(options.step.agent, options.agents);
  if (!helperAgent) {
    options.reporter?.dagRecoveryUnavailable?.({
      stepId: options.step.id,
      failureKind: 'evidence',
      reason: 'No enabled evidence-gathering helper agent is available.',
    });
    return { scheduled: false, result: options.failure };
  }

  options.recoveryRounds.set(rootId, round);

  const helperId = `${rootId}-evidence-feedback-${round}`;
  const retryId = `${rootId}-retry-${round}`;
  const retryDependsOn = [...new Set([helperId, ...options.step.dependsOn])];
  const feedbackTask = buildEvidenceFeedbackTask(options.step, options.failure);

  options.plan.plan.push(
    {
      id: helperId,
      agent: helperAgent,
      task: feedbackTask,
      dependsOn: [],
      parentStepId: rootId,
    } as DAGPlan['plan'][number],
    {
      id: retryId,
      agent: options.step.agent,
      task: options.step.task,
      dependsOn: retryDependsOn,
      parentStepId: rootId,
    } as DAGPlan['plan'][number],
  );
  options.allIds.add(helperId);
  options.allIds.add(retryId);

  for (const candidate of options.plan.plan) {
    if (candidate.id === options.step.id || options.settled.has(candidate.id)) continue;
    candidate.dependsOn = candidate.dependsOn.map((dep) => (dep === options.step.id ? retryId : dep));
  }

  options.results.set(helperId, {
    id: helperId,
    agent: helperAgent,
    task: feedbackTask,
    dependsOn: [],
    status: 'pending',
    parentStepId: rootId,
    edgeType: 'feedback',
    spawnedByAgent: options.step.agent,
    failureKind: 'evidence',
  });
  options.results.set(retryId, {
    id: retryId,
    agent: options.step.agent,
    task: options.step.task,
    dependsOn: retryDependsOn,
    status: 'pending',
    parentStepId: rootId,
    edgeType: 'feedback',
    failureKind: 'evidence',
  });
  options.reporter?.dagStepRetry(options.step.id, helperAgent, round, options.failure.error ?? 'Evidence gate failed');
  options.reporter?.dagRecoveryScheduled?.({
    failedStepId: options.step.id,
    helperStepId: helperId,
    helperAgent,
    retryStepId: retryId,
    failureKind: 'evidence',
    reason: options.failure.error ?? 'Evidence gate failed',
  });

  return {
    scheduled: true,
    result: {
      ...options.failure,
      replacementStepId: retryId,
    },
  };
}

function maybeScheduleRecovery(options: RecoveryOptions): {
  scheduled: boolean;
  result: StepResult;
} {
  const rootId = options.step.parentStepId ?? options.step.id;
  const round = (options.recoveryRounds.get(rootId) ?? 0) + 1;
  if (round > MAX_RECOVERY_ROUNDS) {
    options.reporter?.dagRecoveryUnavailable?.({
      stepId: options.step.id,
      failureKind: options.failure.failureKind,
      reason: `Recovery round limit (${MAX_RECOVERY_ROUNDS}) was reached for ${rootId}.`,
    });
    return {
      scheduled: false,
      result: {
        ...options.failure,
        blockerKind: 'no-progress',
      },
    };
  }

  const helperAgent = selectRecoveryAgent(options.failure.failureKind, options.agents);
  if (!helperAgent) {
    options.reporter?.dagRecoveryUnavailable?.({
      stepId: options.step.id,
      failureKind: options.failure.failureKind,
      reason: 'No enabled recovery helper agent matches this failure type.',
    });
    return { scheduled: false, result: options.failure };
  }

  options.recoveryRounds.set(rootId, round);

  const helperId = `${rootId}-recovery-${round}`;
  const retryId = `${rootId}-retry-${round}`;
  const retryDependsOn = [...new Set([helperId, ...options.step.dependsOn])];

  options.plan.plan.push(
    {
      id: helperId,
      agent: helperAgent,
      task: buildRecoveryTask(options.step, options.failure),
      dependsOn: [],
      parentStepId: rootId,
    } as DAGPlan['plan'][number],
    {
      id: retryId,
      agent: options.step.agent,
      task: options.step.task,
      dependsOn: retryDependsOn,
      parentStepId: rootId,
    } as DAGPlan['plan'][number],
  );
  options.allIds.add(helperId);
  options.allIds.add(retryId);

  for (const candidate of options.plan.plan) {
    if (candidate.id === options.step.id || options.settled.has(candidate.id)) continue;
    candidate.dependsOn = candidate.dependsOn.map((dep) => (dep === options.step.id ? retryId : dep));
  }

  options.results.set(helperId, {
    id: helperId,
    agent: helperAgent,
    task: buildRecoveryTask(options.step, options.failure),
    dependsOn: [],
    status: 'pending',
    parentStepId: rootId,
    edgeType: 'recovery',
    spawnedByAgent: options.step.agent,
    failureKind: options.failure.failureKind,
  });
  options.results.set(retryId, {
    id: retryId,
    agent: options.step.agent,
    task: options.step.task,
    dependsOn: retryDependsOn,
    status: 'pending',
    parentStepId: rootId,
    edgeType: 'recovery',
    failureKind: options.failure.failureKind,
  });
  options.reporter?.dagStepRetry(options.step.id, helperAgent, round, options.failure.error ?? 'unknown');
  options.reporter?.dagRecoveryScheduled?.({
    failedStepId: options.step.id,
    helperStepId: helperId,
    helperAgent,
    retryStepId: retryId,
    failureKind: options.failure.failureKind,
    reason: options.failure.error ?? 'unknown',
  });

  return {
    scheduled: true,
    result: {
      ...options.failure,
      replacementStepId: retryId,
    },
  };
}

function selectEvidenceFeedbackAgent(
  failedAgent: string,
  agents: Map<string, AgentDefinition>,
): string | null {
  const preferences =
    failedAgent === 'usage-classification-tree'
      ? ['researcher', 'bug-debugger']
      : failedAgent === 'researcher'
        ? ['bug-debugger']
        : ['researcher', 'bug-debugger'];

  return preferences.find((name) => name !== failedAgent && agents.has(name)) ?? null;
}

function selectRecoveryAgent(
  failureKind: StepResult['failureKind'],
  agents: Map<string, AgentDefinition>,
): string | null {
  if (failureKind === 'timeout') return null;

  const preferences =
    failureKind === 'compile' || failureKind === 'build' || failureKind === 'lint' || failureKind === 'tooling'
      ? ['build-fixer', 'bug-debugger']
      : failureKind === 'test'
        ? ['test-stabilizer', 'bug-debugger', 'build-fixer']
        : ['bug-debugger', 'build-fixer', 'test-stabilizer'];

  return preferences.find((name) => agents.has(name)) ?? null;
}

function buildEvidenceFeedbackTask(step: DAGPlan['plan'][number], failure: StepResult): string {
  const findings = failure.evidenceGate?.findings ?? [];
  const rejectedClaimIds = new Set(
    findings
      .filter((finding) => finding.severity === 'high' && finding.claimId)
      .map((finding) => finding.claimId!),
  );
  const rejectedClaims = (failure.evidenceGate?.claims ?? [])
    .filter((claim) => rejectedClaimIds.has(claim.id))
    .map((claim) => `- ${claim.id}: ${claim.claim}`)
    .join('\n');
  const findingLines = findings
    .map((finding) => `- ${finding.severity}${finding.claimId ? ` ${finding.claimId}` : ''}: ${finding.message}`)
    .join('\n') || '- Evidence gate failed without detailed findings.';
  const previousOutput = (failure.output ?? '').slice(0, 4_000);

  return [
    `Evidence feedback router loop for failed step "${step.id}".`,
    `Original agent: ${step.agent}`,
    `Original task: ${step.task}`,
    `Failure kind: ${failure.failureKind ?? 'evidence'}`,
    `Error message:\n${failure.error ?? 'Evidence gate failed'}`,
    '',
    'The router is re-evaluating this evidence failure and adding the agent/tool evidence needed before retrying the original step.',
    'Use available tools when freshness, current prevalence, or direct support is required.',
    'Return concise remediation guidance and source details that the retrying agent can use.',
    '',
    'Required output:',
    '1. Evidence gaps found by the deterministic gate.',
    '2. Current/recent sources or tool results that directly support the rejected claims, including URL/title/retrievedAt when available.',
    '3. Claims that must instead be downgraded, lowered in score, marked unavailable, or removed if direct evidence is not available.',
    '4. A short retry instruction for the original agent.',
    '',
    'Evidence findings:',
    findingLines,
    '',
    rejectedClaims ? `Rejected claims:\n${rejectedClaims}` : 'Rejected claims: none parsed.',
    '',
    'Previous failed output excerpt:',
    previousOutput || '_No output captured._',
  ].join('\n');
}

function buildRecoveryTask(step: DAGPlan['plan'][number], failure: StepResult): string {
  const errorDisplay = failure.error?.slice(0, 500) ?? 'unknown error'; // Truncate for readability
  const recoveryInstructions: string[] = [];
  
  recoveryInstructions.push(`Fix the failed step "${step.id}" before it is retried.`);
  recoveryInstructions.push(`Original agent: ${step.agent}`);
  recoveryInstructions.push(`Original task: ${step.task}`);
  recoveryInstructions.push(`Failure kind: ${failure.failureKind ?? 'unknown'}`);
  recoveryInstructions.push(`Error message:\n${errorDisplay}`);
  
  // Add dynamic instructions based on failure type
  if (failure.failureKind === 'test') {
    recoveryInstructions.push(`\n\n=== TEST FAILURE RECOVERY PRIORITY ===`);
    recoveryInstructions.push(`1. Analyze the test failure and identify the root cause`);
    recoveryInstructions.push(`2. Fix the failing test WITHOUT changing production code behavior`);
    recoveryInstructions.push(`3. Consider: flaky test, missing fixture, assertion timing, brittle selector`);
    recoveryInstructions.push(`4. Run the test multiple times to verify it's stable`);
    recoveryInstructions.push(`5. If test was truly flaky, improve test reliability`);
    recoveryInstructions.push(`6. If test needs new tests, add missing coverage`);
    recoveryInstructions.push(`7. Verify all tests pass before reporting success`);
  }
  
  if (failure.failureKind === 'compile') {
    recoveryInstructions.push(`\n\n=== COMPILATION/TYPE ERROR RECOVERY PRIORITY ===`);
    recoveryInstructions.push(`1. Fix the TypeScript compilation error`);
    recoveryInstructions.push(`2. Do NOT use @ts-ignore, as any, or @ts-expect-error`);
    recoveryInstructions.push(`3. Address missing imports, type mismatches, or undefined variables`);
    recoveryInstructions.push(`4. If you need help, ask for clarification first`);
    recoveryInstructions.push(`5. Compile again after your fix`);
  }
  
  if (failure.failureKind === 'runtime') {
    recoveryInstructions.push(`\n\n=== RUNTIME ERROR RECOVERY PRIORITY ===`);
    recoveryInstructions.push(`1. Analyze the runtime error message carefully`);
    recoveryInstructions.push(`2. Check for null/undefined access, type errors, or unexpected states`);
    recoveryInstructions.push(`3. Add defensive checks if needed, but don't silently ignore errors`);
    recoveryInstructions.push(`4. Consider edge cases that triggered this error`);
  }
  
  recoveryInstructions.push(`\n\nReturn the concrete fix or stabilization needed so the retry can continue.`);
  recoveryInstructions.push(`If you are unsure how to fix this, describe your analysis and ask for help first.`);
  
  return recoveryInstructions.join('\n');
}

function buildStepContext(
  task: string,
  dependsOn: string[],
  results: Map<string, StepResult>,
): string {
  let context = `Your task: ${task}`;

  if (dependsOn.length > 0) {
    const depOutputs = dependsOn
      .map((depId) => {
        const result = results.get(depId);
        if (!result || !result.output) return null;
        return `[${depId}: ${result.agent}]\n${buildDownstreamSafeOutput(result)}`;
      })
      .filter(Boolean);

    if (depOutputs.length > 0) {
      context += `\n\n--- Context from previous steps ---\n\n${depOutputs.join('\n\n')}`;
    }
  }

  return context;
}

function buildDownstreamSafeOutput(result: StepResult): string {
  let output = result.output ?? '';
  const findings = result.evidenceGate?.findings ?? [];
  const rejectedClaimIds = new Set(
    findings
      .filter((finding) => finding.severity === 'high' && finding.claimId)
      .map((finding) => finding.claimId!),
  );
  if (rejectedClaimIds.size > 0) {
    for (const claim of result.evidenceGate?.claims ?? []) {
      if (!rejectedClaimIds.has(claim.id)) continue;
      output = output.replaceAll(claim.claim, `[REJECTED CLAIM REMOVED: ${claim.id}]`);
    }
  }
  if (findings.length > 0) {
    output += `\n\n--- Evidence Gate Findings ---\n${findings.map((finding) =>
      `- ${finding.severity}${finding.claimId ? ` ${finding.claimId}` : ''}: ${finding.message}`,
    ).join('\n')}`;
  }
  return output;
}
