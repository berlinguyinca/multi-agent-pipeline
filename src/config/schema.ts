import type {
  PipelineConfig,
  AgentAssignment,
  HeadlessRuntimeConfig,
  OllamaConfig,
  QualityConfig,
  RouterConfig,
  AgentCreationConfig,
} from '../types/config.js';
import type { AdapterType } from '../types/adapter.js';
import { parseDuration, validateDurationRelationship } from '../utils/duration.js';

const VALID_ADAPTERS: readonly AdapterType[] = ['claude', 'codex', 'ollama', 'hermes'];

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

  if (obj['fallbacks'] !== undefined) {
    assignment.fallbacks = validateFallbacks(obj['fallbacks'], field);
  }

  return assignment;
}

function validateFallbacks(
  value: unknown,
  parentField: string,
): Array<{ adapter: AdapterType; model?: string }> {
  if (!Array.isArray(value)) {
    throw new Error(`agents.${parentField}.fallbacks must be an array`);
  }

  return value.map((entry, index) => {
    const entryField = `agents.${parentField}.fallbacks[${index}]`;
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${entryField} must be an object`);
    }

    const obj = entry as Record<string, unknown>;

    if (!isValidAdapter(obj['adapter'])) {
      throw new Error(
        `${entryField}.adapter must be one of: ${VALID_ADAPTERS.join(', ')}; got "${String(obj['adapter'])}"`
      );
    }

    const adapter = obj['adapter'];

    if (adapter === 'ollama' && (obj['model'] === undefined || obj['model'] === null || obj['model'] === '')) {
      throw new Error(`${entryField}.model is required when adapter is 'ollama'`);
    }

    const fallback: { adapter: AdapterType; model?: string } = { adapter };
    if (typeof obj['model'] === 'string') {
      fallback.model = obj['model'];
    }

    return fallback;
  });
}

function validateHeadlessConfig(value: unknown): Partial<HeadlessRuntimeConfig> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('headless must be an object');
  }

  const obj = value as Record<string, unknown>;
  const headless: Partial<HeadlessRuntimeConfig> = {};

  if (obj['totalTimeoutMs'] !== undefined) {
    if (typeof obj['totalTimeoutMs'] !== 'string' && typeof obj['totalTimeoutMs'] !== 'number') {
      throw new Error('headless.totalTimeoutMs must be a string or number');
    }
    headless.totalTimeoutMs = parseDuration(
      obj['totalTimeoutMs'],
      'headless.totalTimeoutMs',
    );
  }

  if (obj['inactivityTimeoutMs'] !== undefined) {
    if (
      typeof obj['inactivityTimeoutMs'] !== 'string' &&
      typeof obj['inactivityTimeoutMs'] !== 'number'
    ) {
      throw new Error('headless.inactivityTimeoutMs must be a string or number');
    }
    headless.inactivityTimeoutMs = parseDuration(
      obj['inactivityTimeoutMs'],
      'headless.inactivityTimeoutMs',
    );
  }

  if (obj['pollIntervalMs'] !== undefined) {
    if (typeof obj['pollIntervalMs'] !== 'string' && typeof obj['pollIntervalMs'] !== 'number') {
      throw new Error('headless.pollIntervalMs must be a string or number');
    }
    headless.pollIntervalMs = parseDuration(obj['pollIntervalMs'], 'headless.pollIntervalMs');
  }

  if (
    headless.totalTimeoutMs !== undefined &&
    headless.inactivityTimeoutMs !== undefined &&
    headless.pollIntervalMs !== undefined
  ) {
    validateDurationRelationship(
      headless.totalTimeoutMs,
      headless.inactivityTimeoutMs,
      headless.pollIntervalMs,
    );
  }

  return headless;
}

function validateOllamaConfig(value: unknown): Partial<OllamaConfig> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('ollama must be an object');
  }

  const obj = value as Record<string, unknown>;
  const ollama: Partial<OllamaConfig> = {};

  if (obj['host'] !== undefined) {
    if (typeof obj['host'] !== 'string' || obj['host'].trim() === '') {
      throw new Error('ollama.host must be a non-empty string');
    }
    ollama.host = obj['host'].trim();
  }

  return ollama;
}

function validatePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function validateQualityConfig(value: unknown): Partial<QualityConfig> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('quality must be an object');
  }

  const obj = value as Record<string, unknown>;
  const quality: Partial<QualityConfig> = {};

  if (obj['maxSpecQaIterations'] !== undefined) {
    quality.maxSpecQaIterations = validatePositiveInteger(
      obj['maxSpecQaIterations'],
      'quality.maxSpecQaIterations',
    );
  }

  if (obj['maxCodeQaIterations'] !== undefined) {
    quality.maxCodeQaIterations = validatePositiveInteger(
      obj['maxCodeQaIterations'],
      'quality.maxCodeQaIterations',
    );
  }

  return quality;
}

function validateRouterConfig(value: unknown): Partial<RouterConfig> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('router must be an object');
  }

  const obj = value as Record<string, unknown>;
  const router: Partial<RouterConfig> = {};

  if (obj['adapter'] !== undefined) {
    if (!isValidAdapter(obj['adapter'])) {
      throw new Error(
        `router.adapter must be one of: ${VALID_ADAPTERS.join(', ')}; got "${String(obj['adapter'])}"`
      );
    }
    router.adapter = obj['adapter'];
  }

  if (obj['model'] !== undefined) {
    if (typeof obj['model'] !== 'string' || obj['model'].trim() === '') {
      throw new Error('router.model must be a non-empty string');
    }
    router.model = obj['model'].trim();
  }

  if (obj['maxSteps'] !== undefined) {
    router.maxSteps = validatePositiveInteger(obj['maxSteps'], 'router.maxSteps');
  }

  if (obj['timeoutMs'] !== undefined) {
    if (typeof obj['timeoutMs'] !== 'string' && typeof obj['timeoutMs'] !== 'number') {
      throw new Error('router.timeoutMs must be a string or number');
    }
    router.timeoutMs = parseDuration(obj['timeoutMs'], 'router.timeoutMs');
  }

  return router;
}

function validateAgentCreationConfig(value: unknown): Partial<AgentCreationConfig> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('agentCreation must be an object');
  }

  const obj = value as Record<string, unknown>;
  const agentCreation: Partial<AgentCreationConfig> = {};

  if (obj['adapter'] !== undefined) {
    if (!isValidAdapter(obj['adapter'])) {
      throw new Error(
        `agentCreation.adapter must be one of: ${VALID_ADAPTERS.join(', ')}; got "${String(obj['adapter'])}"`
      );
    }
    agentCreation.adapter = obj['adapter'];
  }

  if (obj['model'] !== undefined) {
    if (typeof obj['model'] !== 'string' || obj['model'].trim() === '') {
      throw new Error('agentCreation.model must be a non-empty string');
    }
    agentCreation.model = obj['model'].trim();
  }

  return agentCreation;
}

function validateAgentOverrides(
  value: unknown,
): Record<string, { adapter?: AdapterType; model?: string; enabled?: boolean }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('agentOverrides must be an object');
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, { adapter?: AdapterType; model?: string; enabled?: boolean }> = {};

  for (const [key, entry] of Object.entries(obj)) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`agentOverrides.${key} must be an object`);
    }
    const entryObj = entry as Record<string, unknown>;
    const override: { adapter?: AdapterType; model?: string; enabled?: boolean } = {};

    if (entryObj['adapter'] !== undefined) {
      if (!isValidAdapter(entryObj['adapter'])) {
        throw new Error(
          `agentOverrides.${key}.adapter must be one of: ${VALID_ADAPTERS.join(', ')}; got "${String(entryObj['adapter'])}"`
        );
      }
      override.adapter = entryObj['adapter'];
    }

    if (entryObj['model'] !== undefined) {
      if (typeof entryObj['model'] !== 'string' || entryObj['model'].trim() === '') {
        throw new Error(`agentOverrides.${key}.model must be a non-empty string`);
      }
      override.model = entryObj['model'].trim();
    }

    if (entryObj['enabled'] !== undefined) {
      if (typeof entryObj['enabled'] !== 'boolean') {
        throw new Error(`agentOverrides.${key}.enabled must be a boolean`);
      }
      override.enabled = entryObj['enabled'];
    }

    result[key] = override;
  }

  return result;
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
      qa: agentsObj['qa'] !== undefined
        ? validateAgentAssignment(agentsObj['qa'], 'qa')
        : { adapter: 'codex' as AdapterType },
      execute: agentsObj['execute'] !== undefined
        ? validateAgentAssignment(agentsObj['execute'], 'execute')
        : { adapter: 'claude' as AdapterType },
      docs: agentsObj['docs'] !== undefined
        ? validateAgentAssignment(agentsObj['docs'], 'docs')
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

  let headless: Partial<HeadlessRuntimeConfig> | undefined;
  if (obj['headless'] !== undefined) {
    headless = validateHeadlessConfig(obj['headless']);
  }

  let ollama: Partial<OllamaConfig> | undefined;
  if (obj['ollama'] !== undefined) {
    ollama = validateOllamaConfig(obj['ollama']);
  }

  let quality: Partial<QualityConfig> | undefined;
  if (obj['quality'] !== undefined) {
    quality = validateQualityConfig(obj['quality']);
  }

  let router: Partial<RouterConfig> | undefined;
  if (obj['router'] !== undefined) {
    router = validateRouterConfig(obj['router']);
  }

  let agentCreation: Partial<AgentCreationConfig> | undefined;
  if (obj['agentCreation'] !== undefined) {
    agentCreation = validateAgentCreationConfig(obj['agentCreation']);
  }

  let agentOverrides: Record<string, { adapter?: AdapterType; model?: string; enabled?: boolean }> | undefined;
  if (obj['agentOverrides'] !== undefined) {
    agentOverrides = validateAgentOverrides(obj['agentOverrides']);
  }

  return {
    ...(agents !== undefined ? { agents } : {}),
    ...(ollama !== undefined ? { ollama } : {}),
    ...(quality !== undefined ? { quality } : {}),
    ...(typeof obj['outputDir'] === 'string' ? { outputDir: obj['outputDir'] } : {}),
    ...(typeof obj['gitCheckpoints'] === 'boolean' ? { gitCheckpoints: obj['gitCheckpoints'] } : {}),
    ...(headless !== undefined ? { headless } : {}),
    ...(router !== undefined ? { router } : {}),
    ...(agentCreation !== undefined ? { agentCreation } : {}),
    ...(agentOverrides !== undefined ? { agentOverrides } : {}),
  } as PipelineConfig;
}
