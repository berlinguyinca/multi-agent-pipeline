import type { AgentDefinition } from '../types/agent-definition.js';
import type { AgentAdapter, AdapterConfig, DetectionResult } from '../types/adapter.js';
import type { PipelineConfig } from '../types/config.js';
import type { DAGPlan } from '../types/dag.js';
import { routeTask, type RouterDecision } from '../router/router.js';
import { discoverAutonomousAgent, type AgentDiscoveryDiagnostics } from '../agents/autonomous-discovery.js';
import type { ensureOllamaReady } from '../adapters/ollama-runtime.js';
import type { VerboseReporter } from '../utils/verbose-reporter.js';

export type AdapterFactory = (config: AdapterConfig) => AgentAdapter;
type RouterRuntimeConfig = Parameters<typeof routeTask>[3];

export interface RouterRecoveryDependencies {
  createAdapterFn: AdapterFactory;
  detectAllAdaptersFn: (ollamaHost?: string) => Promise<DetectionResult>;
  ensureOllamaModelReadyFn?: typeof ensureOllamaReady;
}

export interface RouterRecoveryOptions {
  resolvedPrompt: string;
  basePrompt: string;
  agents: Map<string, AgentDefinition>;
  agentsDir: string;
  config: PipelineConfig;
  routerConfig: RouterRuntimeConfig;
  reloadAgents: () => Promise<Map<string, AgentDefinition>>;
  dependencies: RouterRecoveryDependencies;
  reporter?: VerboseReporter;
  maxRecoveryAttempts?: number;
}

export interface RouterRecoveryResult {
  decision: RouterDecision;
  agents: Map<string, AgentDefinition>;
  agentDiscovery: AgentDiscoveryDiagnostics[];
}

export async function routeWithAutonomousRecovery(
  options: RouterRecoveryOptions,
): Promise<RouterRecoveryResult> {
  let agents = options.agents;
  const agentDiscovery: AgentDiscoveryDiagnostics[] = [];
  let decision = await routeTask(
    options.resolvedPrompt,
    agents,
    buildRouterAdapters(options.config, options.dependencies.createAdapterFn),
    options.routerConfig,
  );

  const maxAttempts = options.maxRecoveryAttempts ?? 3;
  for (let attempt = 1; decision.kind === 'no-match' && decision.suggestedAgent && attempt <= maxAttempts; attempt += 1) {
    options.reporter?.routerRecoveryStart({
      attempt,
      maxAttempts,
      suggestedAgent: decision.suggestedAgent.name,
      reason: decision.reason,
    });
    const detection = await options.dependencies.detectAllAdaptersFn(options.config.ollama.host).catch(() => undefined);
    const ensureModelReady = options.dependencies.ensureOllamaModelReadyFn
      ? async (
          model: string,
          host?: string,
          ensureOptions?: Parameters<typeof ensureOllamaReady>[2],
        ) => {
          options.reporter?.modelPreparationStart(model);
          try {
            await options.dependencies.ensureOllamaModelReadyFn!(model, host, ensureOptions);
            options.reporter?.modelPreparationComplete(model);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            options.reporter?.modelPreparationFailed(model, message);
            throw err;
          }
        }
      : undefined;
    const discovery = await discoverAutonomousAgent({
      userTask: options.basePrompt,
      agentsDir: options.agentsDir,
      config: options.config,
      suggestedAgent: decision.suggestedAgent,
      reason: decision.reason,
      installedModels: detection?.ollama.models ?? [],
      createAdapterFn: options.dependencies.createAdapterFn,
      ensureModelReadyFn: ensureModelReady,
    });
    agentDiscovery.push(discovery.diagnostics);
    if (!discovery.agent) {
      options.reporter?.routerRecoveryComplete({
        status: discovery.diagnostics.status,
        detail: discovery.diagnostics.warnings.join(' ') || 'No valid generated agent was available for reroute.',
      });
      break;
    }

    agents = await options.reloadAgents();
    decision = await routeTask(
      options.resolvedPrompt,
      agents,
      buildRouterAdapters(options.config, options.dependencies.createAdapterFn),
      options.routerConfig,
    );
    options.reporter?.routerRecoveryComplete({
      status: 'rerouted',
      detail: `Created "${discovery.agent.name}" and sent the original prompt back through the router.`,
    });
  }

  if (decision.kind === 'no-match') {
    const fallbackPlan = buildBestEffortFallbackPlan(decision, agents, options.config, options.basePrompt);
    if (fallbackPlan !== null) {
      agentDiscovery.push(buildFallbackDiscoveryDiagnostic(decision, fallbackPlan, agents, options.config));
      options.reporter?.routerRecoveryComplete({
        status: 'fallback',
        detail: `No specialist route could be created; using "${fallbackPlan.plan[0]!.agent}" as the best available fallback.`,
      });
      decision = {
        kind: 'plan',
        plan: fallbackPlan,
        ...(decision.rationale ? { rationale: decision.rationale } : {}),
      };
    }
  }

  return { decision, agents, agentDiscovery };
}

export function buildRouterAdapters(config: PipelineConfig, createAdapterFn: AdapterFactory): AgentAdapter[] {
  const baseModels =
    config.router.consensus?.enabled && config.router.consensus.models.length > 0
      ? config.router.consensus.models.slice(0, 3)
      : [config.router.model, config.router.model, config.router.model];
  const models = config.router.consensus?.enabled ? baseModels : [config.router.model];
  return models.map((model) =>
    createAdapterFn({
      type: config.router.adapter,
      model,
      ...(config.router.adapter === 'ollama'
        ? {
            host: config.ollama.host,
            contextLength: config.ollama.contextLength,
            numParallel: config.ollama.numParallel,
            maxLoadedModels: config.ollama.maxLoadedModels,
          }
        : {}),
    }),
  );
}

export function formatRouterNoMatch(decision: {
  reason: string;
  suggestedAgent?: { name: string; description: string };
}): string {
  const reason = decision.reason.trim().replace(/[.]+$/, '');
  const suggestion = decision.suggestedAgent
    ? ` Suggested agent: ${decision.suggestedAgent.name} — ${decision.suggestedAgent.description}.`
    : '';
  return `No suitable agent available. ${reason}.${suggestion} Create one with: map agent create`;
}

function buildBestEffortFallbackPlan(
  decision: { reason: string; suggestedAgent?: { name: string; description: string } },
  agents: Map<string, AgentDefinition>,
  config: PipelineConfig,
  userTask = '',
): DAGPlan | null {
  const softwarePlan = buildSoftwareLifecycleFallbackPlan(decision, agents, userTask);
  if (softwarePlan) return softwarePlan;

  const fallback = selectBestEffortFallbackAgent(decision, agents);
  if (!fallback) return null;
  const requiresLedger = config.evidence.enabled !== false &&
    config.evidence.mode !== 'off' &&
    config.evidence.requiredAgents.includes(fallback.name);
  return {
    plan: [{
      id: 'step-1',
      agent: fallback.name,
      task: [
        'Provide the best possible response with the available agent registry.',
        `Router recovery reason: ${decision.reason}`,
        decision.suggestedAgent
          ? `Missing suggested agent: ${decision.suggestedAgent.name} — ${decision.suggestedAgent.description}`
          : '',
        requiresLedger
          ? 'Because this fallback agent is evidence-gated, include a ## Claim Evidence Ledger section with JSON claims and direct evidence before finalizing.'
          : '',
      ].filter(Boolean).join(' '),
      dependsOn: [],
    }],
  };
}

function buildSoftwareLifecycleFallbackPlan(
  decision: { reason: string; suggestedAgent?: { name: string; description: string } },
  agents: Map<string, AgentDefinition>,
  userTask: string,
): DAGPlan | null {
  const text = `${userTask} ${decision.reason} ${decision.suggestedAgent?.name ?? ''} ${decision.suggestedAgent?.description ?? ''}`.toLowerCase();
  const softwareSignals = /\b(software|implementation|feature|code|build|test|tdd|docs|developer|lifecycle|tool|cli|app|service)\b/.test(text);
  if (!softwareSignals) return null;

  const commonRequired = ['spec-writer', 'spec-qa-reviewer', 'code-qa-analyst'];
  if (!commonRequired.every((name) => agents.has(name))) return null;
  const hasUnifiedCoder = agents.has('coder');
  if (!hasUnifiedCoder && !['tdd-engineer', 'implementation-coder'].every((name) => agents.has(name))) {
    return null;
  }

  const plan: DAGPlan['plan'] = [];
  const requestContext = JSON.stringify(userTask.replace(/\s+/g, ' ').trim().slice(0, 1200));
  const add = (agent: string, task: string, dependsOn: string[]): void => {
    if (!agents.has(agent)) return;
    plan.push({ id: `step-${plan.length + 1}`, agent, task, dependsOn });
  };

  add(
    'spec-writer',
    `Create an implementation-ready specification from this original request: ${requestContext}. Router recovery reason: ${decision.reason}. Do not return a protocol acknowledgment; produce concrete requirements, acceptance criteria, and verification notes.`,
    [],
  );
  add('spec-qa-reviewer', 'Review the specification for ambiguity, testability, edge cases, and missing acceptance criteria. Surface concrete blockers and missing verification requirements.', ['step-1']);
  add('spec-writer', 'Revise the specification to resolve all concrete blockers identified by spec QA. Preserve valid prior content, close missing acceptance criteria, and make the spec implementation-ready without returning protocol prose.', ['step-2']);
  let qaStepId = '';
  if (hasUnifiedCoder) {
    add('coder', 'Execute the full spec-to-code lifecycle from the revised spec, incorporating the spec QA findings as required constraints. Use strict TDD, isolated test services, implementation, and documentation. Do not return a protocol acknowledgment; create files, run tests, and report verification evidence.', ['step-3']);
    add('code-qa-analyst', 'Review implementation correctness, test adequacy, isolated service usage, and conformance to the revised spec plus spec QA blockers. End with the Structured QA Verdict JSON.', ['step-4']);
    qaStepId = 'step-5';
  } else {
    add('tdd-engineer', 'Write focused failing tests from the revised spec and the spec QA findings. Use Docker-backed isolated test services when databases or external services are needed. Run the targeted test command and capture red-state evidence.', ['step-3']);
    add('implementation-coder', 'Implement the smallest coherent change satisfying the revised spec, the spec QA blockers, and the failing tests. Do not return a protocol acknowledgment; edit files, run the relevant test command, and use isolated Docker-backed services instead of host databases when needed.', ['step-4']);
    add('code-qa-analyst', 'Review implementation correctness, test adequacy, isolated service usage, and conformance to the revised spec plus spec QA blockers. End with the Structured QA Verdict JSON.', ['step-5']);
    qaStepId = 'step-6';
  }
  add('legal-license-advisor', 'Recommend compatible license options from language and dependency evidence after implementation QA.', [qaStepId]);
  const legalStepId = `step-${plan.findIndex((step) => step.agent === 'legal-license-advisor') + 1}`;
  add('docs-maintainer', 'Update README usage documentation and license coverage after verified implementation and license recommendation.', [agents.has('legal-license-advisor') ? legalStepId : qaStepId]);
  const readinessDependency = agents.has('docs-maintainer')
    ? `step-${plan.findIndex((step) => step.agent === 'docs-maintainer') + 1}`
    : agents.has('legal-license-advisor')
      ? legalStepId
      : qaStepId;
  add('release-readiness-reviewer', 'Assess final readiness, verification evidence, residual risk, and handoff status.', [readinessDependency]);

  return { plan };
}

function selectBestEffortFallbackAgent(
  decision: { reason: string; suggestedAgent?: { name: string; description: string } },
  agents: Map<string, AgentDefinition>,
): AgentDefinition | undefined {
  const suggested = decision.suggestedAgent?.name ? findAgentByLooseName(decision.suggestedAgent.name, agents) : undefined;
  if (suggested) return suggested;

  const text = `${decision.reason} ${decision.suggestedAgent?.description ?? ''}`.toLowerCase();
  for (const agent of agents.values()) {
    if (text.includes(agent.name.toLowerCase())) return agent;
  }

  const softwareSignals = /\b(software|implementation|feature|code|build|test|tdd|docs|developer|lifecycle|tool|cli|app|service)\b/.test(text);
  if (softwareSignals) {
    for (const name of ['software-delivery', 'implementation-coder', 'adviser', 'coder']) {
      const agent = findAgentByLooseName(name, agents);
      if (agent) return agent;
    }
  }

  return [...agents.values()].find((agent) => agent.name === 'researcher') ??
    [...agents.values()].find((agent) => agent.output.type === 'answer') ??
    [...agents.values()][0];
}

function findAgentByLooseName(name: string, agents: Map<string, AgentDefinition>): AgentDefinition | undefined {
  if (agents.has(name)) return agents.get(name);
  const normalized = name.toLowerCase().replace(/_/g, '-');
  for (const candidate of [
    normalized,
    normalized.replace(/^agent-/, ''),
    normalized.replace(/-agent$/, ''),
    normalized.replace(/^agent[-_]/, ''),
  ]) {
    const agent = agents.get(candidate);
    if (agent) return agent;
  }
  return undefined;
}

function buildFallbackDiscoveryDiagnostic(
  decision: { reason: string; suggestedAgent?: { name: string; description: string } },
  fallbackPlan: DAGPlan,
  agents: Map<string, AgentDefinition>,
  config: PipelineConfig,
): AgentDiscoveryDiagnostics {
  const fallbackAgent = fallbackPlan.plan[0]!.agent;
  return {
    status: 'skipped',
    suggestedAgent: decision.suggestedAgent ?? {
      name: fallbackAgent,
      description: 'Best available fallback agent',
    },
    reason: decision.reason,
    model: {
      selected: {
        model: agents.get(fallbackAgent)?.model ?? 'unknown',
        installed: true,
        fitsHardware: true,
        estimatedMemoryGb: 0,
        reason: 'best-effort fallback used after autonomous discovery could not produce a route',
      },
      candidates: [],
      rejected: [],
      hardware: {
        totalMemoryGb: 0,
        usableMemoryGb: 0,
        maxLoadedModels: config.ollama.maxLoadedModels,
        numParallel: config.ollama.numParallel,
      },
    },
    consensus: { method: 'three-candidates-local-judge', candidates: [] },
    warnings: [`Router no-match recovered with best-effort fallback agent "${fallbackAgent}".`],
  };
}
