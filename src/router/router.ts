// src/router/router.ts
import type { AgentAdapter } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { RouterConfig as PipelineRouterConfig } from '../types/config.js';
import type { ConsensusDiagnostics, ConsensusParticipant, DAGPlan, RouterRationale } from '../types/dag.js';
import { validateDAGPlan } from '../types/dag.js';
import { buildRouterPrompt } from './prompt-builder.js';
import { isAbortError } from '../utils/error.js';

type RouterConfig = Pick<PipelineRouterConfig, 'maxSteps' | 'timeoutMs' | 'maxStepRetries' | 'retryDelayMs' | 'consensus'> & {
  ollamaConcurrency?: number;
};

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
  consensus?: ConsensusDiagnostics;
  rationale?: RouterRationale;
}

export interface RouterNoMatchDecision {
  kind: 'no-match';
  reason: string;
  suggestedAgent?: SuggestedAgentDefinition;
  rationale?: RouterRationale;
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
  const deterministicChemicalPlan = buildDomainFallbackDecision(userTask, agents, {
    kind: 'no-match',
    reason: 'Deterministic chemical taxonomy/usage route selected.',
  });
  if (deterministicChemicalPlan && shouldUseDeterministicChemicalRoute(userTask)) {
    return deterministicChemicalPlan;
  }

  const prompt = buildRouterPrompt(agents, userTask, config.maxSteps);
  const adapters = Array.isArray(routerAdapter) ? routerAdapter : [routerAdapter];

  if (shouldUseRouterConsensus(adapters, config)) {
    return routeTaskWithConsensus(userTask, prompt, agents, adapters.slice(0, 3), config, signal, onChunk);
  }

  const output = await runRouterAdapter(prompt, adapters[0]!, config, signal, onChunk);
  const decision = finalizeRouterOutput(output, agents, userTask);
  return decision.kind === 'no-match'
    ? buildDomainFallbackDecision(userTask, agents, decision) ?? decision
    : decision;
}

function shouldUseRouterConsensus(adapters: AgentAdapter[], config: RouterConfig): boolean {
  return Boolean(config.consensus?.enabled && config.consensus.scope === 'router' && adapters.length > 1);
}

async function routeTaskWithConsensus(
  userTask: string,
  prompt: string,
  agents: Map<string, AgentDefinition>,
  adapters: AgentAdapter[],
  config: RouterConfig,
  signal?: AbortSignal,
  onChunk?: (chunk: string) => void,
): Promise<RouterDecision> {
  const concurrency = Math.max(1, Math.min(adapters.length, Math.floor(config.ollamaConcurrency ?? 1)));
  const candidates = await mapWithConcurrency(adapters, concurrency, async (adapter) => {
    const modelName = adapter.model ?? adapter.type;
    try {
      onChunk?.(`\n[router:${modelName}]\n`);
      const output = await runRouterAdapter(prompt, adapter, config, signal, onChunk);
      const decision = finalizeRouterOutput(output, agents, userTask);
      return { model: modelName, decision, score: scoreRouterDecision(decision) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { model: modelName, error: message };
    }
  });

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
    const selectedNoMatch = valid.sort((a, b) => b.score - a.score)[0]!.decision;
    return buildDomainFallbackDecision(userTask, agents, selectedNoMatch) ?? selectedNoMatch;
  }

  const consensusPlan = buildMajorityPlan(planCandidates.map((candidate) => candidate.decision.plan));
  if (consensusPlan !== null) {
    const rationale = planCandidates.find((candidate) => candidate.decision.rationale)?.decision.rationale;
    return {
      kind: 'plan',
      plan: consensusPlan,
      consensus: buildRouterConsensusDiagnostics(candidates, consensusPlan, 'majority'),
      ...(rationale ? { rationale } : {}),
    };
  }

  const selected = planCandidates.sort((a, b) => b.score - a.score)[0]!;
  return {
    ...selected.decision,
    consensus: buildRouterConsensusDiagnostics(candidates, selected.decision.plan, 'best-valid-fallback'),
  };
}

function buildDomainFallbackDecision(
  userTask: string,
  agents: Map<string, AgentDefinition>,
  original: RouterDecision,
): RouterPlanDecision | null {
  const task = userTask.toLowerCase();
  const requestContext = compactStepRequestContext(userTask);
  const wantsChemicalTaxonomy = /\b(classification|taxonomy|classyfire|chemont)\b/.test(task) &&
    /\b(compound|chemical|drug|metabolite|cocaine|aspirin|alanine|molecule)\b/.test(task);
  const wantsUsage = /\b(usage|usages|use|uses|medical|metabolomics|lcb|exposure)\b/.test(task) &&
    /\b(compound|chemical|drug|metabolite|cocaine|aspirin|alanine|molecule)\b/.test(task);
  if (!wantsChemicalTaxonomy && !wantsUsage) return null;

  const plan: DAGPlan['plan'] = [];
  if (wantsChemicalTaxonomy && agents.has('classyfire-taxonomy-classifier')) {
    plan.push({
      id: 'step-1',
      agent: 'classyfire-taxonomy-classifier',
      task: `Generate a concise ClassyFire/ChemOnt-style chemical taxonomy table for the entity in this user request: ${requestContext}. Do not use the live ClassyFire API. Include a Claim Evidence Ledger with document, knowledge, or URL evidence for every taxonomy claim; do not use model-prior evidence for high-confidence taxonomy claims.`,
      dependsOn: [],
    });
  }
  if (wantsUsage && agents.has('usage-classification-tree')) {
    const taxonomyStepId = plan.find((step) => step.agent === 'classyfire-taxonomy-classifier')?.id;
    plan.push({
      id: `step-${plan.length + 1}`,
      agent: 'usage-classification-tree',
      task: `Generate concise evidence-backed usage, exposure, and commonness tables for the entity and context in this user request: ${requestContext}. Restrict the ranking to the requested medical and metabolomics context; do not rank broad illicit/recreational prevalence unless the user explicitly asks for it. Call web-search before the final answer using a query that covers current medical topical/local anesthetic use, toxicology/metabolomics biomarkers, and current prevalence evidence; include retrievedAt metadata for URL evidence, and do not assign commonnessScore >=65 unless retrieved current/recent prevalence or widespread-use evidence directly supports it. When in doubt, keep scores at 60 or below or mark unavailable.`,
      dependsOn: taxonomyStepId ? [taxonomyStepId] : [],
    });
  }
  if (plan.length === 0) return null;

  return {
    kind: 'plan',
    plan: { plan },
    rationale: {
      selectedAgents: plan.map((step) => ({
        agent: step.agent,
        reason: 'Deterministic domain fallback selected specialized chemical taxonomy/usage agents after the router returned no executable plan.',
      })),
      rejectedAgents: [],
    },
  };
}

function compactStepRequestContext(userTask: string): string {
  const compact = userTask.replace(/\s+/g, ' ').trim();
  const clipped = compact.length > 360 ? `${compact.slice(0, 357)}...` : compact;
  return JSON.stringify(clipped);
}

function shouldUseDeterministicChemicalRoute(userTask: string): boolean {
  const task = userTask.toLowerCase();
  return /\b(classification|taxonomy|classyfire|chemont)\b/.test(task) &&
    /\b(usage|usages|use|uses|medical|metabolomics|lcb|exposure)\b/.test(task) &&
    /\b(compound|chemical|drug|metabolite|cocaine|aspirin|alanine|molecule)\b/.test(task) &&
    /\b(only report|output tables|graph plot|xls cells|customer)\b/.test(task);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  }));

  return results;
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

function finalizeRouterOutput(output: string, agents: Map<string, AgentDefinition>, userTask = ''): RouterDecision {
  const decision = parseRouterDecision(output);

  if (!decision) {
    const cleaned = extractRouterPayload(output);
    throw new Error(`Router returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  const cleanedDecision = cleanRouterDecision(decision, agents, userTask);

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
    return {
      kind: 'plan',
      plan: { plan: normalizePlanSteps(obj['plan']) },
      ...normalizeRouterRationale(obj['rationale']),
    };
  }

  if (obj['kind'] === 'no-match') {
    const reason = obj['reason'];
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('Router returned no-match without a reason');
    }

    const suggested = obj['suggestedAgent'];
    if (suggested === undefined) {
      return {
        kind: 'no-match',
        reason: reason.trim(),
        ...normalizeRouterRationale(obj['rationale']),
      };
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
      ...normalizeRouterRationale(obj['rationale']),
    };
  }

  if (typeof obj['agent'] === 'string' && typeof obj['reason'] === 'string' && obj['reason'].trim()) {
    return {
      kind: 'no-match',
      reason: obj['reason'].trim(),
      rationale: {
        selectedAgents: [],
        rejectedAgents: [{
          agent: obj['agent'].trim(),
          reason: obj['reason'].trim(),
        }],
      },
    };
  }

  throw new Error('Router returned neither a plan nor a no-match decision');
}

function normalizeRouterRationale(value: unknown): { rationale?: RouterRationale } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const obj = value as Record<string, unknown>;
  const selectedAgents = normalizeRationaleEntries(obj['selectedAgents']);
  const rejectedAgents = normalizeRationaleEntries(obj['rejectedAgents']);
  if (selectedAgents.length === 0 && rejectedAgents.length === 0) return {};
  return { rationale: { selectedAgents, rejectedAgents } };
}

function normalizeRationaleEntries(value: unknown): RouterRationale['selectedAgents'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
    )
    .map((entry) => ({
      agent: String(entry['agent'] ?? '').trim(),
      reason: String(entry['reason'] ?? '').trim(),
    }))
    .filter((entry) => entry.agent.length > 0 && entry.reason.length > 0);
}

function cleanRouterDecision(
  decision: RouterDecision,
  agents: Map<string, AgentDefinition>,
  userTask = '',
): RouterDecision {
  if (decision.kind === 'no-match') {
    return decision;
  }

  let cleanedSteps = decision.plan.plan.map((step) => ({
    ...step,
    id: step.id.trim(),
    agent: normalizeRouterAgentName(step.agent.trim(), agents),
    task: cleanRouterTaskText(step.task),
    dependsOn: step.dependsOn.map((dep) => dep.trim()).filter(Boolean),
  }));

  if (shouldPreferChemicalSpecialistPlan(userTask, cleanedSteps)) {
    const droppedIds = new Set(cleanedSteps
      .filter((step) => step.agent === 'researcher')
      .map((step) => step.id));
    cleanedSteps = cleanedSteps
      .filter((step) => !droppedIds.has(step.id))
      .map((step) => ({
        ...step,
        dependsOn: step.dependsOn.filter((dep) => !droppedIds.has(dep)),
      }));
  }

  const ids = new Set(cleanedSteps.map((step) => step.id));
  const existingDependencyTargets = new Set(cleanedSteps.flatMap((step) => step.dependsOn));
  const finalFormatterIndex = cleanedSteps.findIndex((step) => isFormatterStep(step.agent, step.task));
  if (finalFormatterIndex >= 0) {
    const finalFormatter = cleanedSteps[finalFormatterIndex]!;
    const upstreamIds = cleanedSteps
      .slice(0, finalFormatterIndex)
      .filter((step) => step.agent !== finalFormatter.agent)
      .filter((step) => !existingDependencyTargets.has(step.id))
      .map((step) => step.id);
    if (upstreamIds.length > 0 && finalFormatter.dependsOn.length === 0) {
      finalFormatter.dependsOn = upstreamIds;
    }
  }

  return {
    kind: 'plan',
    plan: {
      plan: cleanedSteps.map((step) => ({
        ...step,
        dependsOn: step.dependsOn.filter((dep) => ids.has(dep)),
      })),
    },
    ...(decision.rationale ? { rationale: cleanRouterRationale(decision.rationale, agents, new Set(cleanedSteps.map((step) => step.agent))) } : {}),
  };
}

function shouldPreferChemicalSpecialistPlan(
  userTask: string,
  steps: Array<{ agent: string; task: string }>,
): boolean {
  const task = userTask.toLowerCase();
  const asksChemicalReport = /\b(classification|taxonomy|classyfire|chemont)\b/.test(task) &&
    /\b(usage|usages|use|uses|medical|metabolomics|lcb|exposure)\b/.test(task) &&
    /\b(compound|chemical|drug|metabolite|cocaine|aspirin|alanine|molecule)\b/.test(task);
  if (!asksChemicalReport) return false;

  const agentsInPlan = new Set(steps.map((step) => step.agent));
  return agentsInPlan.has('classyfire-taxonomy-classifier') &&
    agentsInPlan.has('usage-classification-tree') &&
    agentsInPlan.has('researcher');
}

function cleanRouterRationale(
  rationale: RouterRationale,
  agents: Map<string, AgentDefinition>,
  planAgents?: Set<string>,
): RouterRationale {
  return {
    selectedAgents: rationale.selectedAgents.map((entry) => ({
      ...entry,
      agent: normalizeRouterAgentName(entry.agent, agents),
    })).filter((entry) => !planAgents || planAgents.has(entry.agent)),
    rejectedAgents: rationale.rejectedAgents.map((entry) => ({
      ...entry,
      agent: normalizeRouterAgentName(entry.agent, agents),
    })),
  };
}

function isFormatterStep(agent: string, task: string): boolean {
  return agent === 'output-formatter' || /\b(format|render|xls|presentation|report)\b/i.test(task);
}


function normalizeRouterAgentName(agent: string, agents: Map<string, AgentDefinition>): string {
  if (agents.has(agent)) return agent;

  const withoutAgentPrefix = agent.replace(/^agent[-_]/i, '');
  if (agents.has(withoutAgentPrefix)) return withoutAgentPrefix;

  const withoutAgentSuffix = agent.replace(/[-_]agent$/i, '');
  if (agents.has(withoutAgentSuffix)) return withoutAgentSuffix;

  const normalized = agent.toLowerCase().replace(/_/g, '-');
  for (const candidate of [normalized, normalized.replace(/^agent-/, ''), normalized.replace(/-agent$/, '')]) {
    if (agents.has(candidate)) return candidate;
  }

  return agent;
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

function buildRouterConsensusDiagnostics(
  candidates: Array<
    | { model: string; decision: RouterDecision; score: number }
    | { model: string; error: string }
  >,
  selectedPlan: DAGPlan,
  method: string,
): ConsensusDiagnostics {
  const selectedSignatures = new Set(selectedPlan.plan.map(planStepSignature));
  const denominator = Math.max(1, selectedSignatures.size);
  const participants: ConsensusParticipant[] = candidates.map((candidate, index) => {
    if ('error' in candidate) {
      return {
        run: index + 1,
        provider: 'ollama',
        model: candidate.model,
        status: 'failed',
        contribution: 0,
        detail: candidate.error,
      };
    }

    if (candidate.decision.kind !== 'plan') {
      return {
        run: index + 1,
        provider: 'ollama',
        model: candidate.model,
        status: 'rejected',
        contribution: 0,
        detail: candidate.decision.reason,
      };
    }

    const matchedSteps = candidate.decision.plan.plan
      .map(planStepSignature)
      .filter((signature) => selectedSignatures.has(signature)).length;
    const contribution = matchedSteps / denominator;
    return {
      run: index + 1,
      provider: 'ollama',
      model: candidate.model,
      status: contribution > 0 ? 'contributed' : 'rejected',
      contribution,
      detail: `${matchedSteps}/${denominator} selected plan step${denominator === 1 ? '' : 's'} matched`,
    };
  });

  const selected = participants
    .filter((participant) => participant.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution || a.run - b.run)[0];

  return {
    source: 'router',
    method,
    runs: candidates.length,
    selectedRun: selected?.run,
    selectedModel: selected?.model,
    agreement:
      participants.reduce((sum, participant) => sum + participant.contribution, 0) /
      Math.max(1, participants.length),
    participants,
  };
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
