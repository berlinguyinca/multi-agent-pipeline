// src/router/router.ts
import type { AgentAdapter } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { RouterConfig as PipelineRouterConfig } from '../types/config.js';
import type { DAGPlan } from '../types/dag.js';
import { validateDAGPlan } from '../types/dag.js';
import { buildRouterPrompt } from './prompt-builder.js';
import { isAbortError } from '../utils/error.js';

type RouterConfig = Pick<PipelineRouterConfig, 'maxSteps' | 'timeoutMs' | 'maxStepRetries' | 'retryDelayMs' | 'consensus'>;

const DEFAULT_MAX_STEP_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 3_000;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export interface SuggestedAgentDefinition {
  name: string;
  description: string;
}

export interface RouterPlanDecision {
  kind: 'plan';
  plan: DAGPlan;
}

export interface RouterNoMatchDecision {
  kind: 'no-match';
  reason: string;
  suggestedAgent?: SuggestedAgentDefinition;
}

export type RouterDecision = RouterPlanDecision | RouterNoMatchDecision;

export async function routeTask(
  userTask: string,
  agents: Map<string, AgentDefinition>,
  routerAdapter: AgentAdapter | AgentAdapter[],
  config: RouterConfig,
  signal?: AbortSignal,
  onChunk?: (chunk: string) => void,
): Promise<RouterDecision> {
  const prompt = buildRouterPrompt(agents, userTask, config.maxSteps);
  const adapters = Array.isArray(routerAdapter) ? routerAdapter : [routerAdapter];

  if (shouldUseRouterConsensus(adapters, config)) {
    return routeTaskWithConsensus(prompt, agents, adapters.slice(0, 3), config, signal, onChunk);
  }

  const output = await runRouterAdapter(prompt, adapters[0]!, config, signal, onChunk);
  return finalizeRouterOutput(output, agents);
}

function shouldUseRouterConsensus(adapters: AgentAdapter[], config: RouterConfig): boolean {
  return Boolean(config.consensus?.enabled && config.consensus.scope === 'router' && adapters.length > 1);
}

async function routeTaskWithConsensus(
  prompt: string,
  agents: Map<string, AgentDefinition>,
  adapters: AgentAdapter[],
  config: RouterConfig,
  signal?: AbortSignal,
  onChunk?: (chunk: string) => void,
): Promise<RouterDecision> {
  const candidates = await Promise.all(
    adapters.map(async (adapter) => {
      const modelName = adapter.model ?? adapter.type;
      try {
        onChunk?.(`\n[router:${modelName}]\n`);
        const output = await runRouterAdapter(prompt, adapter, config, signal, onChunk);
        const decision = finalizeRouterOutput(output, agents);
        return { model: modelName, decision, score: scoreRouterDecision(decision) };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { model: modelName, error: message };
      }
    }),
  );

  const valid = candidates.filter(
    (candidate): candidate is { model: string; decision: RouterDecision; score: number } =>
      'decision' in candidate,
  );

  if (valid.length === 0) {
    const errors = candidates
      .map((candidate) => `${candidate.model}: ${'error' in candidate ? candidate.error : 'unknown failure'}`)
      .join('; ');
    throw new Error(`Router consensus failed: no valid candidates. ${errors}`);
  }

  const planCandidates = valid.filter(
    (candidate): candidate is { model: string; decision: RouterPlanDecision; score: number } =>
      candidate.decision.kind === 'plan',
  );

  if (planCandidates.length === 0) {
    return valid.sort((a, b) => b.score - a.score)[0]!.decision;
  }

  const consensusPlan = buildMajorityPlan(planCandidates.map((candidate) => candidate.decision.plan));
  if (consensusPlan !== null) {
    return { kind: 'plan', plan: consensusPlan };
  }

  return planCandidates.sort((a, b) => b.score - a.score)[0]!.decision;
}

async function runRouterAdapter(
  prompt: string,
  routerAdapter: AgentAdapter,
  config: RouterConfig,
  signal?: AbortSignal,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  let output = '';
  let timeoutMsForAttempt = config.timeoutMs;
  const maxRetries = config.maxStepRetries ?? DEFAULT_MAX_STEP_RETRIES;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    output = '';
    let timedOut = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMsForAttempt);
    const abortExternal = () => controller.abort();
    signal?.addEventListener('abort', abortExternal);
    const runOptions =
      routerAdapter.type === 'ollama'
        ? {
            signal: controller.signal,
            responseFormat: 'json',
            hideThinking: true,
            think: false,
            systemPrompt:
              'Return only valid JSON for the router decision. Do not include reasoning, markdown, code fences, or commentary.',
          }
        : {
            signal: controller.signal,
            systemPrompt:
              'Return only valid JSON for the router decision. Do not include reasoning, markdown, code fences, or commentary.',
          };

    try {
      for await (const chunk of routerAdapter.run(prompt, runOptions)) {
        output += chunk;
        onChunk?.(chunk);
      }
      break;
    } catch (err: unknown) {
      if (isAbortError(err)) {
        if (signal?.aborted) {
          throw new Error('Router was cancelled');
        }
        if (!timedOut || attempt >= maxRetries) {
          throw new Error(
            timedOut
              ? `Router timed out after ${timeoutMsForAttempt}ms`
              : 'Router operation was aborted',
          );
        }
        timeoutMsForAttempt *= 2;
        if (retryDelayMs > 0) {
          await delay(retryDelayMs, signal);
          if (signal?.aborted) {
            throw new Error('Router was cancelled');
          }
        }
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortExternal);
    }
  }

  return output;
}

function finalizeRouterOutput(output: string, agents: Map<string, AgentDefinition>): RouterDecision {
  const decision = parseRouterDecision(output);

  if (!decision) {
    const cleaned = extractRouterPayload(output);
    throw new Error(`Router returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  const cleanedDecision = cleanRouterDecision(decision);

  if (cleanedDecision.kind === 'no-match') {
    return cleanedDecision;
  }

  for (const step of cleanedDecision.plan.plan) {
    if (!agents.has(step.agent)) {
      throw new Error(
        `Router referenced unknown agent: "${step.agent}". Available: ${[...agents.keys()].join(', ')}`,
      );
    }
  }

  const validation = validateDAGPlan(cleanedDecision.plan);
  if (!validation.valid) {
    throw new Error(`Router produced invalid DAG: ${validation.error}`);
  }

  return cleanedDecision;
}

function extractRouterPayload(text: string): string {
  const normalized = normalizeRouterOutput(text).trim();
  const fenced = stripMarkdownFences(normalized);
  if (fenced !== normalized) {
    return fenced;
  }

  const candidate = extractLastParsableRouterJson(normalized);
  return candidate ?? normalized;
}

function extractLastParsableRouterJson(text: string): string | null {
  const braceStarts: number[] = [];
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    braceStarts.push(start);
  }

  for (let i = braceStarts.length - 1; i >= 0; i -= 1) {
    const start = braceStarts[i]!;
    const candidate = sliceBalancedJson(text, start);
    if (candidate === null) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function stripMarkdownFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  return match ? match[1].trim() : text;
}

function normalizeRouterOutput(text: string): string {
  let result = '';
  let line: string[] = [];
  let cursor = 0;

  function flushLine(keepNewline: boolean): void {
    result += line.join('');
    if (keepNewline) {
      result += '\n';
    }
    line = [];
    cursor = 0;
  }

  function writeChar(char: string): void {
    if (cursor < line.length) {
      line[cursor] = char;
    } else {
      line.push(char);
    }
    cursor += 1;
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '\u001b') {
      const next = text[index + 1];

      if (next === '[') {
        index += 2;
        let params = '';
        while (index < text.length) {
          const code = text[index];
          if (code >= '@' && code <= '~') {
            const amount = params === '' ? 1 : Number(params.split(';')[0] ?? '1') || 1;
            switch (code) {
              case 'D':
                cursor = Math.max(0, cursor - amount);
                break;
              case 'C':
                cursor = Math.min(line.length, cursor + amount);
                break;
              case 'K':
                line = line.slice(0, cursor);
                break;
              case 'G':
                cursor = Math.max(0, amount - 1);
                break;
              case 'H':
                cursor = 0;
                break;
              default:
                break;
            }
            break;
          }
          params += code;
          index += 1;
        }
        continue;
      }

      if (next === ']') {
        index += 2;
        while (index < text.length && text[index] !== '\u0007') {
          index += 1;
        }
        continue;
      }

      if (next === 'P' || next === 'X' || next === '^' || next === '_') {
        index += 2;
        while (index < text.length) {
          if (text[index] === '\u001b' && text[index + 1] === '\\') {
            index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }

      continue;
    }

    if (char === '\b' || char === '\u007f') {
      if (cursor > 0) {
        cursor -= 1;
        line.splice(cursor, 1);
      }
      continue;
    }

    if (char === '\r') {
      cursor = 0;
      continue;
    }

    if (char === '\n') {
      flushLine(true);
      continue;
    }

    if (char < ' ' && char !== '\t') {
      continue;
    }

    writeChar(char);
  }

  return result + line.join('');
}

function parseRouterDecision(text: string): RouterDecision | null {
  const normalized = normalizeRouterOutput(text).trim();
  const fenced = stripMarkdownFences(normalized);
  const searchSpace = fenced !== normalized ? fenced : normalized;

  try {
    return normalizeRouterDecision(JSON.parse(searchSpace));
  } catch {
    // fall through
  }

  const braceStarts: number[] = [];
  for (let start = searchSpace.indexOf('{'); start !== -1; start = searchSpace.indexOf('{', start + 1)) {
    braceStarts.push(start);
  }

  for (let i = braceStarts.length - 1; i >= 0; i -= 1) {
    const start = braceStarts[i]!;
    const candidate = sliceBalancedJson(searchSpace, start);
    if (candidate === null) continue;
    try {
      return normalizeRouterDecision(JSON.parse(candidate));
    } catch {
      continue;
    }
  }

  return null;
}

function sliceBalancedJson(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1).trim();
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}

function normalizeRouterDecision(parsed: unknown): RouterDecision {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Router returned an unexpected payload shape');
  }

  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj['plan'])) {
    return { kind: 'plan', plan: { plan: normalizePlanSteps(obj['plan']) } };
  }

  if (obj['kind'] === 'no-match') {
    const reason = obj['reason'];
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('Router returned no-match without a reason');
    }

    const suggested = obj['suggestedAgent'];
    if (suggested === undefined) {
      return { kind: 'no-match', reason: reason.trim() };
    }

    if (typeof suggested !== 'object' || suggested === null) {
      throw new Error('Router returned invalid suggestedAgent metadata');
    }

    const suggestedObj = suggested as Record<string, unknown>;
    const name = suggestedObj['name'];
    const description = suggestedObj['description'];

    if (typeof name !== 'string' || typeof description !== 'string') {
      throw new Error('Router returned incomplete suggestedAgent metadata');
    }

    return {
      kind: 'no-match',
      reason: reason.trim(),
      suggestedAgent: {
        name: name.trim(),
        description: description.trim(),
      },
    };
  }

  throw new Error('Router returned neither a plan nor a no-match decision');
}

function cleanRouterDecision(decision: RouterDecision): RouterDecision {
  if (decision.kind === 'no-match') {
    return decision;
  }

  return {
    kind: 'plan',
    plan: {
      plan: decision.plan.plan.map((step) => ({
        ...step,
        id: step.id.trim(),
        agent: step.agent.trim(),
        task: cleanRouterTaskText(step.task),
        dependsOn: step.dependsOn.map((dep) => dep.trim()),
      })),
    },
  };
}

function cleanRouterTaskText(task: string): string {
  const rawTokens = tokenizeTask(task);
  const significantTokens = rawTokens.map(normalizeTaskToken).filter((token) => token.length > 0);
  const uniqueTokens = new Set(significantTokens);

  if (significantTokens.length >= 4 && uniqueTokens.size <= 1) {
    throw new Error('Router produced degenerate repeated task text');
  }

  const collapsedTokens: string[] = [];
  let previousNormalized = '';
  for (const token of rawTokens) {
    const normalized = normalizeTaskToken(token);
    if (normalized.length === 0) {
      continue;
    }
    if (normalized === previousNormalized) {
      continue;
    }
    collapsedTokens.push(token);
    previousNormalized = normalized;
  }

  let cleaned = collapsedTokens.join(' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length > 320) {
    cleaned = trimAtWordBoundary(cleaned, 320);
  }

  if (cleaned.length === 0 || (significantTokens.length >= 4 && tokenizeTask(cleaned).length <= 1)) {
    throw new Error('Router produced degenerate repeated task text');
  }

  return cleaned;
}

function tokenizeTask(task: string): string[] {
  return task
    .replace(/[|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function normalizeTaskToken(token: string): string {
  return token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function trimAtWordBoundary(text: string, maxLength: number): string {
  const clipped = text.slice(0, maxLength).trim();
  const lastSpace = clipped.lastIndexOf(' ');
  return lastSpace > 0 ? clipped.slice(0, lastSpace).trim() : clipped;
}

function scoreRouterDecision(decision: RouterDecision): number {
  if (decision.kind === 'no-match') {
    return 1;
  }

  return decision.plan.plan.reduce((score, step) => {
    const tokens = tokenizeTask(step.task).map(normalizeTaskToken).filter(Boolean);
    const uniqueTokens = new Set(tokens);
    const repetitionPenalty = tokens.length - uniqueTokens.size;
    const lengthPenalty = Math.max(0, step.task.length - 120) / 20;
    return score + 100 - repetitionPenalty * 10 - lengthPenalty - step.dependsOn.length;
  }, 0) - decision.plan.plan.length;
}

function buildMajorityPlan(plans: DAGPlan[]): DAGPlan | null {
  const votes = new Map<
    string,
    { count: number; firstPlanIndex: number; firstStepIndex: number; step: DAGPlan['plan'][number] }
  >();

  plans.forEach((plan, planIndex) => {
    const seenInPlan = new Set<string>();
    plan.plan.forEach((step, stepIndex) => {
      const signature = planStepSignature(step);
      if (seenInPlan.has(signature)) {
        return;
      }
      seenInPlan.add(signature);
      const existing = votes.get(signature);
      if (existing) {
        existing.count += 1;
        return;
      }
      votes.set(signature, {
        count: 1,
        firstPlanIndex: planIndex,
        firstStepIndex: stepIndex,
        step,
      });
    });
  });

  const majoritySteps = [...votes.values()]
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => a.firstPlanIndex - b.firstPlanIndex || a.firstStepIndex - b.firstStepIndex)
    .map((entry) => ({ ...entry.step, dependsOn: [...entry.step.dependsOn] }));

  if (majoritySteps.length === 0) {
    return null;
  }

  const plan = { plan: majoritySteps };
  const validation = validateDAGPlan(plan);
  return validation.valid ? plan : null;
}

function planStepSignature(step: DAGPlan['plan'][number]): string {
  const taskSignature = tokenizeTask(step.task)
    .map(normalizeTaskToken)
    .filter(Boolean)
    .join(' ');
  return `${step.agent}|${taskSignature}|${step.dependsOn.join(',')}`;
}

function normalizePlanSteps(plan: unknown[]): DAGPlan['plan'] {
  return plan.map((step, index) => {
    if (typeof step !== 'object' || step === null) {
      throw new Error(`Router returned an invalid plan step at index ${index}`);
    }

    const obj = step as Record<string, unknown>;
    const id = obj['id'];
    const agent = obj['agent'];
    const task = obj['task'];
    const dependsOn = obj['dependsOn'];

    if (
      typeof id !== 'string' ||
      typeof agent !== 'string' ||
      typeof task !== 'string' ||
      !Array.isArray(dependsOn) ||
      !dependsOn.every((dep) => typeof dep === 'string')
    ) {
      throw new Error(`Router returned an invalid plan step at index ${index}`);
    }

    return {
      id,
      agent,
      task,
      dependsOn,
    };
  });
}
