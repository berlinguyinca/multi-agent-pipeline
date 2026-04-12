import type { PipelineConfig, AgentAssignment } from '../types/config.js';
import type { AdapterType } from '../types/adapter.js';

const VALID_ADAPTERS: readonly AdapterType[] = ['claude', 'codex', 'ollama'];

function isValidAdapter(value: unknown): value is AdapterType {
  return typeof value === 'string' && (VALID_ADAPTERS as readonly string[]).includes(value);
}

function validateAgentAssignment(value: unknown, field: string): AgentAssignment {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`agents.${field} must be an object`);
  }

  const obj = value as Record<string, unknown>;

  if (!isValidAdapter(obj['adapter'])) {
    throw new Error(
      `agents.${field}.adapter must be one of: ${VALID_ADAPTERS.join(', ')}; got "${String(obj['adapter'])}"`
    );
  }

  const adapter = obj['adapter'];

  if (adapter === 'ollama' && (obj['model'] === undefined || obj['model'] === null || obj['model'] === '')) {
    throw new Error(`agents.${field}.model is required when adapter is 'ollama'`);
  }

  const assignment: AgentAssignment = { adapter };
  if (typeof obj['model'] === 'string') {
    assignment.model = obj['model'];
  }

  return assignment;
}

export function validateConfig(config: unknown): PipelineConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Config must be an object');
  }

  const obj = config as Record<string, unknown>;

  // Validate agents if present
  let agents: PipelineConfig['agents'] | undefined;
  if (obj['agents'] !== undefined) {
    if (typeof obj['agents'] !== 'object' || obj['agents'] === null) {
      throw new Error('agents must be an object');
    }

    const agentsObj = obj['agents'] as Record<string, unknown>;
    agents = {
      spec: agentsObj['spec'] !== undefined
        ? validateAgentAssignment(agentsObj['spec'], 'spec')
        : { adapter: 'claude' as AdapterType },
      review: agentsObj['review'] !== undefined
        ? validateAgentAssignment(agentsObj['review'], 'review')
        : { adapter: 'codex' as AdapterType },
      execute: agentsObj['execute'] !== undefined
        ? validateAgentAssignment(agentsObj['execute'], 'execute')
        : { adapter: 'claude' as AdapterType },
    };
  }

  // Validate outputDir if present
  if (obj['outputDir'] !== undefined && typeof obj['outputDir'] !== 'string') {
    throw new Error('outputDir must be a string');
  }

  // Validate gitCheckpoints if present
  if (obj['gitCheckpoints'] !== undefined && typeof obj['gitCheckpoints'] !== 'boolean') {
    throw new Error('gitCheckpoints must be a boolean');
  }

  return {
    ...(agents !== undefined ? { agents } : {}),
    ...(typeof obj['outputDir'] === 'string' ? { outputDir: obj['outputDir'] } : {}),
    ...(typeof obj['gitCheckpoints'] === 'boolean' ? { gitCheckpoints: obj['gitCheckpoints'] } : {}),
  } as PipelineConfig;
}
