// src/orchestrator/orchestrator.ts
import type { AgentAdapter, AdapterConfig } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { AdapterDefaultsMap, AgentConsensusConfig } from '../types/config.js';
import type { DAGPlan, StepResult, StepStatus } from '../types/dag.js';
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
import { appendSecurityRemediationContext, buildSecurityRemediationContext } from './security-remediation.js';
import { validateStepHandoff } from './handoff-validation.js';
import { runFileConsensusInWorktrees } from './file-consensus.js';

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
  adaptiveReplanning?: {
    enabled?: boolean;
    refreshAgents?: () => Promise<Map<string, AgentDefinition>> | Map<string, AgentDefinition>;
  };
  handoffValidation?: {
    reviewedSpecContent?: string;
  };
  agentConsensus?: AgentConsensusConfig;
}

const MAX_TOOL_CALLS = 4;
const MAX_RECOVERY_ROUNDS = 2;
const DEFAULT_STEP_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_STEP_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 3_000;

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
  const workingDir = retry?.workingDir ?? process.cwd();
  const knowledgeCwd = retry?.knowledgeCwd ?? process.cwd();
  const results = new Map<string, StepResult>();
  const completed = new Set<string>();
  const settled = new Set<string>();
  const failed = new Set<string>();
  const running = new Set<string>();
  const allIds = new Set(mutablePlan.plan.map((s) => s.id));
  const activeAdapters = new Set<AgentAdapter>();
  const recoveryRounds = new Map<string, number>();
  const replans: AdviserReplanEvent[] = [];

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

      // Mark steps whose dependencies failed as skipped
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
          reporter?.dagStepSkipped(step.id, reason);
        }
      }

      const ready = getReadySteps(mutablePlan, completed).filter(
        (s) => !running.has(s.id) && !settled.has(s.id),
      );

      if (ready.length === 0) break;

      const scheduledReady = scheduleReadySteps(ready, agents);

      const executions = scheduledReady.map(async (step) => {
        if (signal?.aborted) {
          return;
        }

        running.add(step.id);
        const agent = agents.get(step.agent)!;
        const startedAt = Date.now();
        reporter?.dagStepStart(step.id, step.agent, step.task);

        let lastError: string | undefined;
        let attempts = 0;
        let stepTimedOut = false;
        let timeoutMsForAttempt = stepTimeoutMs;
        let errorRetries = 0;
        let securityRemediationRetries = 0;
        let securityRemediationContext: string | undefined;

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
            const rawContext = appendSecurityRemediationContext(
              buildStepContext(step.task, step.dependsOn, results),
              securityRemediationContext,
            );

            const configs: AdapterConfig[] = [
              { type: agent.adapter, model: agent.model },
              ...(agent.fallbacks ?? []).map((fb) => ({
                type: fb.adapter,
                model: fb.model,
              })),
            ];

            // Per-step timeout: create a child AbortController that aborts
            // when either the parent signal fires or the step timeout elapses.
            const stepController = new AbortController();
            let stepTimer: ReturnType<typeof setTimeout> | undefined;
            const abortFromParent = () => stepController.abort();
            signal?.addEventListener('abort', abortFromParent, { once: true });
            const consensusConfig = resolveAgentConsensus(agent, agentConsensus);
            const fileConsensusConfig = resolveFileOutputConsensus(agent, agentConsensus);
            const currentTimeoutMs =
              timeoutMsForAttempt * (fileConsensusConfig?.runs ?? consensusConfig?.runs ?? 1);
            if (currentTimeoutMs > 0) {
              stepTimer = setTimeout(() => {
                stepTimedOut = true;
                stepController.abort();
              }, currentTimeoutMs);
            }

            // Resolve thinking: agent-level > adapter-default > undefined
            const resolvedThink = agent.think ?? adapterDefaults?.[agent.adapter]?.think;
            const resolvedTemperature = adapterDefaults?.[agent.adapter]?.temperature;
            const resolvedSeed = adapterDefaults?.[agent.adapter]?.seed;
            const runOnce = (candidateWorkingDir: string, seedOffset = 0) => {
              const tools = createToolRegistry(agent, candidateWorkingDir);
              const context = injectToolCatalog(rawContext, tools, agent.prompt);
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
                  provider: agent.adapter,
                  model: agent.model,
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

            const duration = Date.now() - startedAt;
            const result: StepResult = {
              id: step.id,
              agent: step.agent,
              provider: agent.adapter,
              model: agent.model,
              task: step.task,
              dependsOn: [...step.dependsOn],
              status: 'completed',
              outputType: agent.output.type,
              output: normalizeTerminalText(output),
              duration,
              attempts,
              ...(consensusSelection ? { consensus: consensusSelection.metadata } : {}),
            };

            if (security && shouldGateStep(agent) && result.output) {
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

            const handoffValidation = validateStepHandoff({
              step,
              result,
              priorResults: results,
              reviewedSpecContent: retry?.handoffValidation?.reviewedSpecContent,
            });
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
                refreshAgents: retry.adaptiveReplanning.refreshAgents,
              });
              if (replan) {
                replans.push(replan);
              }
            }
            maybeScheduleGrammarReview({
              step,
              result,
              plan: mutablePlan,
              allIds,
              agents,
              results,
              settled,
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
              const recoveryCreated = maybeScheduleRecovery({
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

  const event = applyAdviserWorkflow({
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

function scheduleReadySteps(
  ready: DAGPlan['plan'],
  agents: Map<string, AgentDefinition>,
): DAGPlan['plan'] {
  const remoteReady: DAGPlan['plan'] = [];
  const localGpuReady: DAGPlan['plan'] = [];

  for (const step of ready) {
    const agent = agents.get(step.agent);
    if (agent?.adapter === 'ollama') {
      localGpuReady.push(step);
    } else {
      remoteReady.push(step);
    }
  }

  if (localGpuReady.length === 0) {
    return remoteReady;
  }

  return [...remoteReady, localGpuReady[0]!];
}

interface ConsensusSelection {
  output: string;
  metadata: NonNullable<StepResult['consensus']>;
}

function resolveAgentConsensus(
  agent: AgentDefinition,
  config: AgentConsensusConfig | undefined,
): AgentConsensusConfig | null {
  if (!config?.enabled || config.runs <= 1) {
    return null;
  }
  if (!config.outputTypes.includes(agent.output.type)) {
    return null;
  }
  return config;
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
}

async function runStepWithTools(options: RunStepWithToolsOptions): Promise<string> {
  let prompt = options.context;

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

    const tool = options.tools.find((candidate) => candidate.name === toolCall.tool);
    const toolResult = tool
      ? await tool.execute(toolCall.params)
      : { success: false, output: '', error: `Unknown tool "${toolCall.tool}"` };

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

function extractToolCall(output: string): { tool: string; params: Record<string, unknown> } | null {
  const trimmed = output.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim() ?? trimmed;
  const candidates = sliceJsonObjects(fenced);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { tool?: unknown; params?: unknown };
      if (typeof parsed.tool !== 'string') continue;
      return {
        tool: parsed.tool,
        params:
          parsed.params && typeof parsed.params === 'object'
            ? (parsed.params as Record<string, unknown>)
            : {},
      };
    } catch {
      continue;
    }
  }

  return null;
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

function classifyFailure(error?: string): StepResult['failureKind'] {
  const normalized = error?.toLowerCase() ?? '';
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

function maybeScheduleRecovery(options: RecoveryOptions): {
  scheduled: boolean;
  result: StepResult;
} {
  const rootId = options.step.parentStepId ?? options.step.id;
  const round = (options.recoveryRounds.get(rootId) ?? 0) + 1;
  if (round > MAX_RECOVERY_ROUNDS) {
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

  return {
    scheduled: true,
    result: {
      ...options.failure,
      replacementStepId: retryId,
    },
  };
}

function selectRecoveryAgent(
  failureKind: StepResult['failureKind'],
  agents: Map<string, AgentDefinition>,
): string | null {
  const preferences =
    failureKind === 'compile' || failureKind === 'build' || failureKind === 'lint' || failureKind === 'tooling'
      ? ['build-fixer', 'bug-debugger']
      : failureKind === 'test'
        ? ['test-stabilizer', 'bug-debugger', 'build-fixer']
        : ['bug-debugger', 'build-fixer', 'test-stabilizer'];

  return preferences.find((name) => agents.has(name)) ?? null;
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
        return `[${depId}: ${result.agent}]\n${result.output}`;
      })
      .filter(Boolean);

    if (depOutputs.length > 0) {
      context += `\n\n--- Context from previous steps ---\n\n${depOutputs.join('\n\n')}`;
    }
  }

  return context;
}
