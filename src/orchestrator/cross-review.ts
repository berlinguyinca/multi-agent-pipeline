import type { AgentDefinition } from '../types/agent-definition.js';
import type { AdapterType } from '../types/adapter.js';
import type { CrossReviewConfig, CrossReviewGateKey } from '../types/config.js';
import type { CrossReviewLedger, DAGStep, StepResult } from '../types/dag.js';
import type { HeadlessCrossReviewSummary } from '../types/headless.js';

export interface CrossReviewDecision {
  shouldReview: boolean;
  gate?: CrossReviewGateKey;
  reason: string;
}

export interface CrossReviewJudgeDecision {
  decision: NonNullable<CrossReviewLedger['judgeDecision']>;
  rationale: string;
  remediation: string[];
  residualRisks: string[];
}

export interface CrossReviewJudgeSelection {
  judgeAgent: string;
  degradedIndependence: boolean;
}

export interface CrossReviewModelOverride {
  adapter?: AdapterType;
  model?: string;
}

const PLANNING_AGENTS = new Set(['adviser']);
const CROSS_REVIEW_HELPER_ID_PATTERN = /-(peer-review|judge)-\d+$/;
const REVIEWER_AGENT_PREFERENCES = ['code-qa-analyst', 'release-readiness-reviewer', 'spec-qa-reviewer'];
const JUDGE_AGENT_PREFERENCES = ['release-readiness-reviewer', 'adviser', 'code-qa-analyst', 'spec-qa-reviewer'];
const VALID_JUDGE_DECISIONS = new Set<CrossReviewJudgeDecision['decision']>([
  'accept',
  'revise',
  'combine',
  'degraded',
]);

export function shouldCrossReviewStep(options: {
  config: CrossReviewConfig;
  step: DAGStep;
  result: StepResult;
  agent: AgentDefinition;
  round: number;
}): CrossReviewDecision {
  const { config, step, result, agent, round } = options;

  if (!config.enabled) {
    return { shouldReview: false, reason: 'cross-review is disabled' };
  }
  if (round > config.maxRounds) {
    return { shouldReview: false, reason: `cross-review round ${round} exceeds maxRounds ${config.maxRounds}` };
  }
  if (isCrossReviewHelperStep(step)) {
    return { shouldReview: false, reason: 'step is a generated cross-review helper' };
  }

  if (agent.output.type === 'files') {
    if (isPartialFileOutputPreservation(result)) {
      return { shouldReview: false, reason: 'partial file-output artifacts continue to downstream repair instead of cross-review revision' };
    }
    return config.gates.fileOutputs
      ? { shouldReview: true, gate: 'fileOutputs', reason: 'file-output agent requires cross-review' }
      : { shouldReview: false, reason: 'fileOutputs cross-review gate is disabled' };
  }

  if (!result.output?.trim()) {
    return { shouldReview: false, reason: 'non-file output is empty' };
  }

  if (config.gates.planning && (PLANNING_AGENTS.has(step.agent) || PLANNING_AGENTS.has(agent.name))) {
    return { shouldReview: true, gate: 'planning', reason: `${step.agent} is a planning agent` };
  }
  if (config.gates.releaseReadiness && (step.agent === 'release-readiness-reviewer' || agent.name === 'release-readiness-reviewer')) {
    return { shouldReview: true, gate: 'releaseReadiness', reason: 'release readiness output requires cross-review' };
  }
  if (config.gates.security && `${step.agent} ${agent.name}`.toLowerCase().includes('security')) {
    return { shouldReview: true, gate: 'security', reason: 'security-sensitive output requires cross-review' };
  }

  return { shouldReview: false, reason: 'no enabled cross-review gate matched this step' };
}


function isPartialFileOutputPreservation(result: StepResult): boolean {
  return (result.filesCreated?.length ?? 0) > 0 &&
    Boolean(result.output?.includes('File-output agent reached its tool-call limit after modifying the workspace.'));
}

export function isCrossReviewHelperStep(step: Pick<DAGStep, 'id'>): boolean {
  return CROSS_REVIEW_HELPER_ID_PATTERN.test(step.id);
}

export function selectCrossReviewReviewerAgent(
  sourceAgent: string,
  agents: Map<string, AgentDefinition>,
): string | null {
  return selectPreferredAgent(REVIEWER_AGENT_PREFERENCES, new Set([sourceAgent]), agents);
}

export function selectCrossReviewJudgeAgent(
  sourceAgent: string,
  reviewerAgent: string,
  agents: Map<string, AgentDefinition>,
  options: { preferSeparatePanel?: boolean } = {},
): string {
  return selectCrossReviewJudgeSelection(sourceAgent, reviewerAgent, agents, options).judgeAgent;
}

export function selectCrossReviewJudgeSelection(
  sourceAgent: string,
  reviewerAgent: string,
  agents: Map<string, AgentDefinition>,
  options: { preferSeparatePanel?: boolean } = {},
): CrossReviewJudgeSelection {
  const preferSeparatePanel = options.preferSeparatePanel !== false;
  if (preferSeparatePanel) {
    const separateJudge =
      selectPreferredAgent(JUDGE_AGENT_PREFERENCES, new Set([sourceAgent, reviewerAgent]), agents) ??
      selectAnyEligibleJudgeAgent(new Set([sourceAgent, reviewerAgent]), agents);
    if (separateJudge) {
      return { judgeAgent: separateJudge, degradedIndependence: false };
    }
    return { judgeAgent: reviewerAgent, degradedIndependence: true };
  }

  const judgeAgent =
    selectPreferredAgent(JUDGE_AGENT_PREFERENCES, new Set([sourceAgent]), agents) ??
    selectAnyEligibleJudgeAgent(new Set([sourceAgent]), agents) ??
    reviewerAgent;
  return { judgeAgent, degradedIndependence: false };
}

export function resolveCrossReviewModelOverrides(options: {
  config: CrossReviewConfig;
  reviewerAgent: string;
  judgeAgent: string;
  agents: Map<string, AgentDefinition>;
}): { review?: CrossReviewModelOverride; judge?: CrossReviewModelOverride } {
  const modelSpecs = options.config.judge.models.map((entry) => entry.trim()).filter(Boolean);
  if (modelSpecs.length === 0) {
    return {};
  }

  if (modelSpecs.length === 1) {
    return {
      judge: parseCrossReviewModelOverride(
        modelSpecs[0]!,
        options.agents.get(options.judgeAgent)?.adapter,
      ),
    };
  }

  return {
    review: parseCrossReviewModelOverride(
      modelSpecs[0]!,
      options.agents.get(options.reviewerAgent)?.adapter,
    ),
    judge: parseCrossReviewModelOverride(
      modelSpecs[1]!,
      options.agents.get(options.judgeAgent)?.adapter,
    ),
  };
}

export function buildCrossReviewReviewStep(options: {
  step: DAGStep;
  result: StepResult;
  reviewerAgent: string;
  round: number;
  gate: string;
  override?: CrossReviewModelOverride;
}): DAGStep {
  const rootStepId = rootIdFor(options.step);
  return {
    id: `${rootStepId}-peer-review-${options.round}`,
    agent: options.reviewerAgent,
    task: buildReviewTask(options.step, options.result, options.gate, options.round),
    dependsOn: [options.step.id],
    ...(options.override?.adapter ? { adapter: options.override.adapter } : {}),
    ...(options.override?.model ? { model: options.override.model } : {}),
    parentStepId: rootStepId,
  };
}

export function buildCrossReviewJudgeStep(options: {
  step: DAGStep;
  result: StepResult;
  reviewStepId: string;
  judgeAgent: string;
  round: number;
  gate: string;
  override?: CrossReviewModelOverride;
}): DAGStep {
  const rootStepId = rootIdFor(options.step);
  return {
    id: `${rootStepId}-judge-${options.round}`,
    agent: options.judgeAgent,
    task: buildJudgeTask(options.step, options.result, options.reviewStepId, options.gate, options.round),
    dependsOn: [options.step.id, options.reviewStepId],
    ...(options.override?.adapter ? { adapter: options.override.adapter } : {}),
    ...(options.override?.model ? { model: options.override.model } : {}),
    parentStepId: rootStepId,
  };
}

export function buildCrossReviewRevisionStep(options: {
  step: DAGStep;
  judgeStepId: string;
  round: number;
  remediation: string[];
}): DAGStep {
  const rootStepId = rootIdFor(options.step);
  const remediation = normalizeStringList(options.remediation);
  return {
    id: `${rootStepId}-revision-${options.round}`,
    agent: options.step.agent,
    task: [
      'Revise the original step output to address the cross-review judge remediation.',
      'Preserve correct prior work, avoid unrelated changes, and do not ask the user to choose between models.',
      '',
      `Original step: ${options.step.id}`,
      `Original agent: ${options.step.agent}`,
      '',
      'Original task:',
      options.step.task,
      '',
      'Required remediation:',
      ...(remediation.length > 0 ? remediation.map((item) => `- ${item}`) : ['- Address the judge rationale and document any residual risk.']),
    ].join('\n'),
    dependsOn: [options.judgeStepId],
    parentStepId: rootStepId,
  };
}

export function parseCrossReviewJudgeDecision(output: string): CrossReviewJudgeDecision {
  const parsed = parseFirstJsonObject(output);
  if (!parsed) {
    return degradedDecision('Cross-review judge returned invalid JSON; treating the gate as degraded.');
  }

  const rawDecision = String(parsed['decision'] ?? '').trim();
  const decision = VALID_JUDGE_DECISIONS.has(rawDecision as CrossReviewJudgeDecision['decision'])
    ? rawDecision as CrossReviewJudgeDecision['decision']
    : 'degraded';

  return {
    decision,
    rationale: String(parsed['rationale'] ?? (decision === 'degraded' ? 'Judge JSON did not include a valid decision.' : '')).trim(),
    remediation: normalizeUnknownStringList(parsed['remediation']),
    residualRisks: normalizeUnknownStringList(parsed['residualRisks']),
  };
}

export function collectCrossReviewLedgers(steps: StepResult[]): CrossReviewLedger[] {
  return steps.flatMap((step) => (step.crossReview ? [step.crossReview] : []));
}

export function summarizeCrossReviewLedgers(ledgers: CrossReviewLedger[]): HeadlessCrossReviewSummary {
  return {
    enabled: ledgers.length > 0,
    totalReviewed: ledgers.length,
    accepted: ledgers.filter((ledger) => ledger.status === 'accepted' || ledger.judgeDecision === 'accept').length,
    revised: ledgers.filter((ledger) => ledger.status === 'revised' || ledger.status === 'revision-requested' || ledger.judgeDecision === 'revise').length,
    degraded: ledgers.filter((ledger) => ledger.status === 'degraded' || ledger.judgeDecision === 'degraded').length,
    budgetExhausted: ledgers.filter((ledger) => ledger.budgetExhausted || ledger.status === 'budget-exhausted').length,
    ledgers,
  };
}

function buildReviewTask(step: DAGStep, result: StepResult, gate: string, round: number): string {
  return [
    'Return a concise structured cross-review critique of the completed MAP step below.',
    'Do not rewrite the output. Identify correctness, evidence, verification, integration, and residual-risk issues.',
    'Reviewer instruction: do not ask the user to choose between models; make an actionable reviewer recommendation for the judge.',
    '',
    `Cross-review gate: ${gate}`,
    `Cross-review round: ${round}`,
    `Original step: ${step.id}`,
    `Original agent: ${step.agent}`,
    '',
    'Original task:',
    step.task,
    '',
    'Original output:',
    describeResultOutput(result),
    '',
    'Required structure:',
    'Critique summary: <brief summary>',
    'Required remediation:',
    '- <specific fix or verification to request, or "none">',
    'Residual risks:',
    '- <risk that remains after acceptance or revision>',
  ].join('\n');
}

function buildJudgeTask(step: DAGStep, result: StepResult, reviewStepId: string, gate: string, round: number): string {
  return [
    'Judge the original step output and its peer-review critique for this cross-review gate.',
    'Return ONLY JSON with this shape:',
    '{"decision":"accept|revise|combine|degraded","rationale":"brief reason","remediation":["specific required action"],"residualRisks":["remaining risk"]}',
    '',
    'Decision rules:',
    '- accept: output is adequate and residual risks are minor or documented.',
    '- revise: original agent should produce a corrected revision before downstream use.',
    '- request verification as remediation under revise or combine when missing verification blocks acceptance.',
    '- combine: reviewer found useful additions that should be merged with otherwise adequate output.',
    '- degraded: judge cannot confidently assess because required evidence or critique is missing.',
    '',
    `Cross-review gate: ${gate}`,
    `Cross-review round: ${round}`,
    `Original step: ${step.id}`,
    `Original agent: ${step.agent}`,
    `Peer-review step: ${reviewStepId}`,
    '',
    'Original task:',
    step.task,
    '',
    'Original output:',
    describeResultOutput(result),
  ].join('\n');
}

function describeResultOutput(result: StepResult): string {
  const lines: string[] = [];
  if (result.output?.trim()) {
    lines.push(result.output.trim());
  }
  if (result.filesCreated?.length) {
    lines.push('', 'Files created:', ...result.filesCreated.map((file) => `- ${file}`));
  }
  return lines.join('\n').trim() || '(no textual output captured)';
}

function parseFirstJsonObject(output: string): Record<string, unknown> | null {
  for (let start = output.indexOf('{'); start !== -1; start = output.indexOf('{', start + 1)) {
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
  }
  return null;
}

function rootIdFor(step: DAGStep): string {
  return step.parentStepId ?? step.id;
}

function normalizeUnknownStringList(value: unknown): string[] {
  return Array.isArray(value) ? normalizeStringList(value) : [];
}

function normalizeStringList(value: unknown[]): string[] {
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function degradedDecision(rationale: string): CrossReviewJudgeDecision {
  return {
    decision: 'degraded',
    rationale,
    remediation: [],
    residualRisks: [],
  };
}

function selectPreferredAgent(
  preferences: string[],
  excludedAgents: Set<string>,
  agents: Map<string, AgentDefinition>,
): string | null {
  return preferences.find((candidate) => !excludedAgents.has(candidate) && agents.has(candidate)) ?? null;
}

function selectAnyEligibleJudgeAgent(
  excludedAgents: Set<string>,
  agents: Map<string, AgentDefinition>,
): string | null {
  for (const [name, agent] of agents) {
    if (excludedAgents.has(name)) continue;
    if (agent.output.type === 'files') continue;
    return name;
  }
  return null;
}

function parseCrossReviewModelOverride(
  value: string,
  defaultAdapter: AdapterType | undefined,
): CrossReviewModelOverride {
  const trimmed = value.trim();
  const slash = trimmed.indexOf('/');
  if (slash > 0) {
    const adapter = trimmed.slice(0, slash);
    const model = trimmed.slice(slash + 1).trim();
    if (isAdapterType(adapter) && model.length > 0) {
      return { adapter, model };
    }
  }
  return {
    ...(defaultAdapter ? { adapter: defaultAdapter } : {}),
    model: trimmed,
  };
}

function isAdapterType(value: string): value is AdapterType {
  return value === 'ollama' || value === 'claude' || value === 'codex' || value === 'hermes' || value === 'metadata' || value === 'huggingface';
}
