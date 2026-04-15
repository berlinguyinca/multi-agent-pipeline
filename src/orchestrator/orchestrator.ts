// src/orchestrator/orchestrator.ts
import type { AgentAdapter, AdapterConfig } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { AdapterDefaultsMap } from '../types/config.js';
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

export interface DAGExecutionResult {
  success: boolean;
  steps: StepResult[];
  plan: DAGPlan;
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

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (signal?.aborted) break;
          attempts = attempt + 1;
          stepTimedOut = false;

          if (attempt > 0) {
            reporter?.dagStepRetry(step.id, step.agent, attempt, lastError ?? 'unknown');
            await delay(retryDelayMs, signal);
            if (signal?.aborted) break;
          }

          try {
            const tools = createToolRegistry(agent, workingDir);
            const rawContext = buildStepContext(step.task, step.dependsOn, results);
            const context = injectToolCatalog(rawContext, tools, agent.prompt);

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
             const currentTimeoutMs = timeoutMsForAttempt;
             if (currentTimeoutMs > 0) {
               stepTimer = setTimeout(() => {
                 stepTimedOut = true;
                 stepController.abort();
               }, currentTimeoutMs);
             }

            // Resolve thinking: agent-level > adapter-default > undefined
            const resolvedThink = agent.think ?? adapterDefaults?.[agent.adapter]?.think;

            let output: string;
            try {
              output = await runStepWithTools({
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
                workingDir,
              });
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
              status: 'completed',
              outputType: agent.output.type,
              output,
              duration,
              attempts,
            };

            if (security && shouldGateStep(agent) && output) {
              reporter?.securityGateStart(step.id, step.agent);
              const securityStartedAt = Date.now();
              const securityResult = await runSecurityGate({
                content: output,
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
                results.set(step.id, {
                  ...result,
                  status: 'failed',
                  securityPassed: false,
                  securityFindings: securityResult.findings,
                  error: `Security gate failed with ${securityResult.findings.length} finding${securityResult.findings.length === 1 ? '' : 's'}`,
                });
                failed.add(step.id);
                reporter?.securityGateFailed(step.id, securityResult.findings.length);
                return;
              }

              result.securityPassed = true;
              result.securityFindings = securityResult.findings;
              reporter?.securityGatePassed(step.id, Date.now() - securityStartedAt);
            }

            results.set(step.id, result);
            completed.add(step.id);
            settled.add(step.id);
            if (step.agent === 'result-judge' && result.output?.trim()) {
              await persistLearningCandidate(step, result.output, knowledgeCwd);
            }
            reporter?.dagStepComplete(step.id, step.agent, duration);
            lastError = undefined;
            break; // Success — exit retry loop
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
            if (!isRetryable(err) || attempt >= retryBudget) {
              const duration = Date.now() - startedAt;
              const baseFailure: StepResult = {
                id: step.id,
                agent: step.agent,
                provider: agent.adapter,
                model: agent.model,
                task: step.task,
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
              break; // Non-retryable or retries exhausted — exit retry loop
            }
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
  };
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
