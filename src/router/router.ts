// src/router/router.ts
import type { AgentAdapter } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { RouterConfig as PipelineRouterConfig } from '../types/config.js';
import type { DAGPlan } from '../types/dag.js';
import { validateDAGPlan } from '../types/dag.js';
import { buildRouterPrompt } from './prompt-builder.js';
import { isAbortError } from '../utils/error.js';

type RouterConfig = Pick<PipelineRouterConfig, 'maxSteps' | 'timeoutMs' | 'maxStepRetries' | 'retryDelayMs'>;

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
  routerAdapter: AgentAdapter,
  config: RouterConfig,
  signal?: AbortSignal,
  onChunk?: (chunk: string) => void,
): Promise<RouterDecision> {
  const prompt = buildRouterPrompt(agents, userTask, config.maxSteps);
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

  const decision = parseRouterDecision(output);

  if (!decision) {
    const cleaned = extractRouterPayload(output);
    throw new Error(`Router returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (decision.kind === 'no-match') {
    return decision;
  }

  for (const step of decision.plan.plan) {
    if (!agents.has(step.agent)) {
      throw new Error(
        `Router referenced unknown agent: "${step.agent}". Available: ${[...agents.keys()].join(', ')}`,
      );
    }
  }

  const validation = validateDAGPlan(decision.plan);
  if (!validation.valid) {
    throw new Error(`Router produced invalid DAG: ${validation.error}`);
  }

  return decision;
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
