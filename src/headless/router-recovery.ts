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
    const fallbackPlan = buildBestEffortFallbackPlan(decision, agents);
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
): DAGPlan | null {
  const fallback = [...agents.values()].find((agent) => agent.name === 'researcher') ??
    [...agents.values()].find((agent) => agent.output.type === 'answer') ??
    [...agents.values()][0];
  if (!fallback) return null;
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
      ].filter(Boolean).join(' '),
      dependsOn: [],
    }],
  };
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
