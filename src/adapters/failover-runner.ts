import type { AdapterConfig, AgentAdapter } from '../types/adapter.js';
import type { AgentAssignment } from '../types/config.js';
import { assignmentToAdapterConfig } from '../tui/runtime.js';
import { isQuotaExhaustion } from './quota-detector.js';
import { AllAdaptersExhaustedError } from '../utils/error.js';

export async function runWithFailover<T>(
  configs: AdapterConfig[],
  factory: (config: AdapterConfig) => AgentAdapter,
  execute: (adapter: AgentAdapter) => Promise<T>,
): Promise<T> {
  if (configs.length === 0) {
    throw new Error('runWithFailover requires at least one adapter config');
  }

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i]!;
    const adapter = factory(config);

    try {
      return await execute(adapter);
    } catch (err: unknown) {
      const isLast = i === configs.length - 1;

      if (isQuotaExhaustion(err) && !isLast) {
        const nextConfig = configs[i + 1]!;
        console.error(
          `[MAP] Adapter ${config.type} quota exhausted, failing over to ${nextConfig.type}`,
        );
        continue;
      }

      throw err;
    }
  }

  throw new AllAdaptersExhaustedError(configs.map((c) => c.type));
}

export function buildAdapterChain(
  assignment: AgentAssignment,
  ollamaHost?: string,
): AdapterConfig[] {
  const primary = assignmentToAdapterConfig(assignment, ollamaHost);
  const fallbacks = (assignment.fallbacks ?? []).map((fb) =>
    assignmentToAdapterConfig(fb, ollamaHost),
  );
  return [primary, ...fallbacks];
}
