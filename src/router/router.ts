// src/router/router.ts
import type { AgentAdapter } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { DAGPlan } from '../types/dag.js';
import { validateDAGPlan } from '../types/dag.js';
import { buildRouterPrompt } from './prompt-builder.js';

interface RouterConfig {
  maxSteps: number;
  timeoutMs: number;
}

export async function routeTask(
  userTask: string,
  agents: Map<string, AgentDefinition>,
  routerAdapter: AgentAdapter,
  config: RouterConfig,
): Promise<DAGPlan> {
  const prompt = buildRouterPrompt(agents, userTask, config.maxSteps);

  let output = '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    for await (const chunk of routerAdapter.run(prompt, { signal: controller.signal })) {
      output += chunk;
    }
  } finally {
    clearTimeout(timeout);
  }

  const cleaned = stripMarkdownFences(output.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Router returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  const plan = parsed as DAGPlan;

  for (const step of plan.plan) {
    if (!agents.has(step.agent)) {
      throw new Error(
        `Router referenced unknown agent: "${step.agent}". Available: ${[...agents.keys()].join(', ')}`,
      );
    }
  }

  const validation = validateDAGPlan(plan);
  if (!validation.valid) {
    throw new Error(`Router produced invalid DAG: ${validation.error}`);
  }

  return plan;
}

function stripMarkdownFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  return match ? match[1].trim() : text;
}
