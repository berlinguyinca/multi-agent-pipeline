import type {
  PipelineConfig,
  AgentAssignment,
  GitHubConfig,
  HeadlessRuntimeConfig,
  OllamaConfig,
  QualityConfig,
  RouterConfig,
  RouterConsensusConfig,
  AgentConsensusConfig,
  FileOutputConsensusConfig,
  AgentCreationConfig,
  AdapterDefaultsMap,
  EvidenceConfig,
} from '../types/config.js';
import type { AdapterType } from '../types/adapter.js';
import { parseDuration, validateDurationRelationship } from '../utils/duration.js';
import { DEFAULT_AGENT_CONSENSUS_CONFIG, DEFAULT_ROUTER_CONSENSUS_CONFIG } from './defaults.js';

const VALID_ADAPTERS: readonly AdapterType[] = ['claude', 'codex', 'ollama', 'hermes', 'metadata'];
const VALID_AGENT_CONSENSUS_OUTPUT_TYPES = ['answer', 'data', 'presentation'] as const;

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

function validateGitHubConfig(value: unknown): Partial<GitHubConfig> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('github must be an object');
  }

  const obj = value as Record<string, unknown>;
  const github: Partial<GitHubConfig> = {};

  if (obj['token'] !== undefined) {
    if (typeof obj['token'] !== 'string' || obj['token'].trim() === '') {
      throw new Error('github.token must be a non-empty string');
    }
    github.token = obj['token'].trim();
  }

  return github;
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

  if (obj['contextLength'] !== undefined) {
    ollama.contextLength = validatePositiveInteger(
      obj['contextLength'],
      'ollama.contextLength',
    );
  }

  if (obj['numParallel'] !== undefined) {
    ollama.numParallel = validatePositiveInteger(
      obj['numParallel'],
      'ollama.numParallel',
    );
  }

  if (obj['maxLoadedModels'] !== undefined) {
    ollama.maxLoadedModels = validatePositiveInteger(
      obj['maxLoadedModels'],
      'ollama.maxLoadedModels',
    );
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

function validateEvidenceConfig(value: unknown): Partial<EvidenceConfig> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('evidence must be an object');
  }
  const obj = value as Record<string, unknown>;
  const evidence: Partial<EvidenceConfig> = {};
  if (obj['enabled'] !== undefined) {
    if (typeof obj['enabled'] !== 'boolean') throw new Error('evidence.enabled must be a boolean');
    evidence.enabled = obj['enabled'];
  }
  if (obj['mode'] !== undefined) {
    if (obj['mode'] !== 'strict' && obj['mode'] !== 'warn' && obj['mode'] !== 'off' && obj['mode'] !== 'high-stakes') {
      throw new Error('evidence.mode must be one of: strict, warn, off, high-stakes');
    }
    evidence.mode = obj['mode'];
    evidence.enabled = obj['mode'] !== 'off';
  }
  if (obj['requiredAgents'] !== undefined) {
    if (!Array.isArray(obj['requiredAgents'])) throw new Error('evidence.requiredAgents must be an array');
    evidence.requiredAgents = obj['requiredAgents'].map((entry, index) => {
      if (typeof entry !== 'string' || entry.trim() === '') {
        throw new Error(`evidence.requiredAgents[${index}] must be a non-empty string`);
      }
      return entry.trim();
    });
  }
  if (obj['currentClaimMaxSourceAgeDays'] !== undefined) {
    evidence.currentClaimMaxSourceAgeDays = validatePositiveInteger(
      obj['currentClaimMaxSourceAgeDays'],
      'evidence.currentClaimMaxSourceAgeDays',
    );
  }
  if (obj['freshnessProfiles'] !== undefined) {
    if (typeof obj['freshnessProfiles'] !== 'object' || obj['freshnessProfiles'] === null || Array.isArray(obj['freshnessProfiles'])) {
      throw new Error('evidence.freshnessProfiles must be an object');
    }
    evidence.freshnessProfiles = Object.fromEntries(
      Object.entries(obj['freshnessProfiles'] as Record<string, unknown>).map(([name, value]) => [
        name,
        validatePositiveInteger(value, `evidence.freshnessProfiles.${name}`),
      ]),
    );
  }
  if (obj['requireRetrievedAtForWebClaims'] !== undefined) {
    if (typeof obj['requireRetrievedAtForWebClaims'] !== 'boolean') {
      throw new Error('evidence.requireRetrievedAtForWebClaims must be a boolean');
    }
    evidence.requireRetrievedAtForWebClaims = obj['requireRetrievedAtForWebClaims'];
  }
  if (obj['blockUnsupportedCurrentClaims'] !== undefined) {
    if (typeof obj['blockUnsupportedCurrentClaims'] !== 'boolean') {
      throw new Error('evidence.blockUnsupportedCurrentClaims must be a boolean');
    }
    evidence.blockUnsupportedCurrentClaims = obj['blockUnsupportedCurrentClaims'];
  }
  if (obj['remediationMaxRetries'] !== undefined) {
    evidence.remediationMaxRetries = validateNonNegativeInteger(
      obj['remediationMaxRetries'],
      'evidence.remediationMaxRetries',
    );
  }
  return evidence;
}

function validateNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
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

  if (obj['stepTimeoutMs'] !== undefined) {
    if (typeof obj['stepTimeoutMs'] !== 'string' && typeof obj['stepTimeoutMs'] !== 'number') {
      throw new Error('router.stepTimeoutMs must be a string or number');
    }
    router.stepTimeoutMs = parseDuration(obj['stepTimeoutMs'], 'router.stepTimeoutMs');
  }

  if (obj['maxStepRetries'] !== undefined) {
    router.maxStepRetries = validatePositiveInteger(obj['maxStepRetries'], 'router.maxStepRetries');
  }

  if (obj['retryDelayMs'] !== undefined) {
    if (typeof obj['retryDelayMs'] !== 'string' && typeof obj['retryDelayMs'] !== 'number') {
      throw new Error('router.retryDelayMs must be a string or number');
    }
    router.retryDelayMs = parseDuration(obj['retryDelayMs'], 'router.retryDelayMs');
  }

  if (obj['consensus'] !== undefined) {
    router.consensus = validateRouterConsensusConfig(obj['consensus']);
  }

  return router;
}

function validateRouterConsensusConfig(value: unknown): RouterConsensusConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('router.consensus must be an object');
  }

  const obj = value as Record<string, unknown>;
  const consensus: RouterConsensusConfig = { ...DEFAULT_ROUTER_CONSENSUS_CONFIG };

  if (obj['enabled'] !== undefined) {
    if (typeof obj['enabled'] !== 'boolean') {
      throw new Error('router.consensus.enabled must be a boolean');
    }
    consensus.enabled = obj['enabled'];
  }

  if (obj['models'] !== undefined) {
    if (!Array.isArray(obj['models'])) {
      throw new Error('router.consensus.models must be an array');
    }
    if (obj['models'].length > 3) {
      throw new Error('router.consensus.models must include at most 3 models');
    }
    consensus.models = obj['models'].map((model, index) => {
      if (typeof model !== 'string' || model.trim() === '') {
        throw new Error(`router.consensus.models[${index}] must be a non-empty string`);
      }
      return model.trim();
    });
  }

  if (obj['scope'] !== undefined) {
    if (obj['scope'] !== 'router') {
      throw new Error('router.consensus.scope must be "router"');
    }
    consensus.scope = 'router';
  }

  if (obj['mode'] !== undefined) {
    if (obj['mode'] !== 'majority') {
      throw new Error('router.consensus.mode must be "majority"');
    }
    consensus.mode = 'majority';
  }

  return consensus;
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

function validateAdapterDefaults(value: unknown): AdapterDefaultsMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('adapterDefaults must be an object');
  }

  const obj = value as Record<string, unknown>;
  const result: AdapterDefaultsMap = {};

  for (const [key, entry] of Object.entries(obj)) {
    if (!isValidAdapter(key)) {
      throw new Error(
        `adapterDefaults key must be one of: ${VALID_ADAPTERS.join(', ')}; got "${key}"`,
      );
    }
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`adapterDefaults.${key} must be an object`);
    }
    const entryObj = entry as Record<string, unknown>;
    const defaults: { think?: boolean; temperature?: number; seed?: number } = {};
    if (entryObj['think'] !== undefined) {
      if (typeof entryObj['think'] !== 'boolean') {
        throw new Error(`adapterDefaults.${key}.think must be a boolean`);
      }
      defaults.think = entryObj['think'];
    }
    if (entryObj['temperature'] !== undefined) {
      if (
        typeof entryObj['temperature'] !== 'number' ||
        !Number.isFinite(entryObj['temperature']) ||
        entryObj['temperature'] < 0
      ) {
        throw new Error(`adapterDefaults.${key}.temperature must be a non-negative number`);
      }
      defaults.temperature = entryObj['temperature'];
    }
    if (entryObj['seed'] !== undefined) {
      if (
        typeof entryObj['seed'] !== 'number' ||
        !Number.isInteger(entryObj['seed'])
      ) {
        throw new Error(`adapterDefaults.${key}.seed must be an integer`);
      }
      defaults.seed = entryObj['seed'];
    }
    result[key as keyof AdapterDefaultsMap] = defaults;
  }

  return result;
}

function validateAgentConsensusConfig(value: unknown): AgentConsensusConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('agentConsensus must be an object');
  }

  const obj = value as Record<string, unknown>;
  const consensus: AgentConsensusConfig = {
    ...DEFAULT_AGENT_CONSENSUS_CONFIG,
    outputTypes: [...DEFAULT_AGENT_CONSENSUS_CONFIG.outputTypes],
    perAgent: { ...DEFAULT_AGENT_CONSENSUS_CONFIG.perAgent },
  };

  if (obj['enabled'] !== undefined) {
    if (typeof obj['enabled'] !== 'boolean') {
      throw new Error('agentConsensus.enabled must be a boolean');
    }
    consensus.enabled = obj['enabled'];
  }

  if (obj['runs'] !== undefined) {
    consensus.runs = validatePositiveInteger(obj['runs'], 'agentConsensus.runs');
    if (consensus.runs > 5) {
      throw new Error('agentConsensus.runs must be at most 5');
    }
  }

  if (obj['outputTypes'] !== undefined) {
    if (!Array.isArray(obj['outputTypes'])) {
      throw new Error('agentConsensus.outputTypes must be an array');
    }
    consensus.outputTypes = obj['outputTypes'].map((type, index) => {
      if (
        typeof type !== 'string' ||
        !(VALID_AGENT_CONSENSUS_OUTPUT_TYPES as readonly string[]).includes(type)
      ) {
        throw new Error(
          `agentConsensus.outputTypes[${index}] must be one of: ${VALID_AGENT_CONSENSUS_OUTPUT_TYPES.join(', ')}`,
        );
      }
      return type as AgentConsensusConfig['outputTypes'][number];
    });
  }

  if (obj['minSimilarity'] !== undefined) {
    if (
      typeof obj['minSimilarity'] !== 'number' ||
      !Number.isFinite(obj['minSimilarity']) ||
      obj['minSimilarity'] < 0 ||
      obj['minSimilarity'] > 1
    ) {
      throw new Error('agentConsensus.minSimilarity must be a number between 0 and 1');
    }
    consensus.minSimilarity = obj['minSimilarity'];
  }

  if (obj['fileOutputs'] !== undefined) {
    consensus.fileOutputs = validateFileOutputConsensusConfig(obj['fileOutputs']);
  }

  if (obj['perAgent'] !== undefined) {
    if (typeof obj['perAgent'] !== 'object' || obj['perAgent'] === null || Array.isArray(obj['perAgent'])) {
      throw new Error('agentConsensus.perAgent must be an object');
    }
    consensus.perAgent = validateAgentConsensusOverrides(obj['perAgent']);
  }

  return consensus;
}

function validateAgentConsensusOverrides(value: unknown): AgentConsensusConfig['perAgent'] {
  const obj = value as Record<string, unknown>;
  const result: AgentConsensusConfig['perAgent'] = {};

  for (const [agentName, overrideValue] of Object.entries(obj)) {
    if (typeof overrideValue !== 'object' || overrideValue === null || Array.isArray(overrideValue)) {
      throw new Error(`agentConsensus.perAgent.${agentName} must be an object`);
    }
    const overrideObj = overrideValue as Record<string, unknown>;
    const override: AgentConsensusConfig['perAgent'][string] = {};

    if (overrideObj['enabled'] !== undefined) {
      if (typeof overrideObj['enabled'] !== 'boolean') {
        throw new Error(`agentConsensus.perAgent.${agentName}.enabled must be a boolean`);
      }
      override.enabled = overrideObj['enabled'];
    }
    if (overrideObj['runs'] !== undefined) {
      override.runs = validatePositiveInteger(overrideObj['runs'], `agentConsensus.perAgent.${agentName}.runs`);
      if (override.runs > 5) {
        throw new Error(`agentConsensus.perAgent.${agentName}.runs must be at most 5`);
      }
    }
    if (overrideObj['outputTypes'] !== undefined) {
      if (!Array.isArray(overrideObj['outputTypes'])) {
        throw new Error(`agentConsensus.perAgent.${agentName}.outputTypes must be an array`);
      }
      override.outputTypes = overrideObj['outputTypes'].map((type, index) => {
        if (
          typeof type !== 'string' ||
          !(VALID_AGENT_CONSENSUS_OUTPUT_TYPES as readonly string[]).includes(type)
        ) {
          throw new Error(
            `agentConsensus.perAgent.${agentName}.outputTypes[${index}] must be one of: ${VALID_AGENT_CONSENSUS_OUTPUT_TYPES.join(', ')}`,
          );
        }
        return type as AgentConsensusConfig['outputTypes'][number];
      });
    }
    if (overrideObj['minSimilarity'] !== undefined) {
      if (
        typeof overrideObj['minSimilarity'] !== 'number' ||
        !Number.isFinite(overrideObj['minSimilarity']) ||
        overrideObj['minSimilarity'] < 0 ||
        overrideObj['minSimilarity'] > 1
      ) {
        throw new Error(`agentConsensus.perAgent.${agentName}.minSimilarity must be a number between 0 and 1`);
      }
      override.minSimilarity = overrideObj['minSimilarity'];
    }

    result[agentName] = override;
  }

  return result;
}

function validateFileOutputConsensusConfig(value: unknown): FileOutputConsensusConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('agentConsensus.fileOutputs must be an object');
  }

  const obj = value as Record<string, unknown>;
  const fileOutputs: FileOutputConsensusConfig = {
    ...DEFAULT_AGENT_CONSENSUS_CONFIG.fileOutputs,
    verificationCommands: [...DEFAULT_AGENT_CONSENSUS_CONFIG.fileOutputs.verificationCommands],
  };

  if (obj['enabled'] !== undefined) {
    if (typeof obj['enabled'] !== 'boolean') {
      throw new Error('agentConsensus.fileOutputs.enabled must be a boolean');
    }
    fileOutputs.enabled = obj['enabled'];
  }

  if (obj['runs'] !== undefined) {
    fileOutputs.runs = validatePositiveInteger(obj['runs'], 'agentConsensus.fileOutputs.runs');
    if (fileOutputs.runs > 5) {
      throw new Error('agentConsensus.fileOutputs.runs must be at most 5');
    }
  }

  if (obj['isolation'] !== undefined) {
    if (obj['isolation'] !== 'git-worktree') {
      throw new Error('agentConsensus.fileOutputs.isolation must be "git-worktree"');
    }
    fileOutputs.isolation = 'git-worktree';
  }

  if (obj['keepWorktreesOnFailure'] !== undefined) {
    if (typeof obj['keepWorktreesOnFailure'] !== 'boolean') {
      throw new Error('agentConsensus.fileOutputs.keepWorktreesOnFailure must be a boolean');
    }
    fileOutputs.keepWorktreesOnFailure = obj['keepWorktreesOnFailure'];
  }

  if (obj['verificationCommands'] !== undefined) {
    if (!Array.isArray(obj['verificationCommands'])) {
      throw new Error('agentConsensus.fileOutputs.verificationCommands must be an array');
    }
    fileOutputs.verificationCommands = obj['verificationCommands'].map((command, index) => {
      if (typeof command !== 'string' || command.trim() === '') {
        throw new Error(`agentConsensus.fileOutputs.verificationCommands[${index}] must be a non-empty string`);
      }
      return command.trim();
    });
  }

  if (obj['selection'] !== undefined) {
    if (obj['selection'] !== 'best-passing-minimal-diff') {
      throw new Error('agentConsensus.fileOutputs.selection must be "best-passing-minimal-diff"');
    }
    fileOutputs.selection = 'best-passing-minimal-diff';
  }

  return fileOutputs;
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

  // Validate outputDir/workspaceDir if present
  if (obj['outputDir'] !== undefined && typeof obj['outputDir'] !== 'string') {
    throw new Error('outputDir must be a string');
  }
  if (obj['workspaceDir'] !== undefined && typeof obj['workspaceDir'] !== 'string') {
    throw new Error('workspaceDir must be a string');
  }

  // Validate gitCheckpoints if present
  if (obj['gitCheckpoints'] !== undefined && typeof obj['gitCheckpoints'] !== 'boolean') {
    throw new Error('gitCheckpoints must be a boolean');
  }

  if (
    obj['generateAgentSummary'] !== undefined &&
    typeof obj['generateAgentSummary'] !== 'boolean'
  ) {
    throw new Error('generateAgentSummary must be a boolean');
  }

  let headless: Partial<HeadlessRuntimeConfig> | undefined;
  if (obj['headless'] !== undefined) {
    headless = validateHeadlessConfig(obj['headless']);
  }

  let github: Partial<GitHubConfig> | undefined;
  if (obj['github'] !== undefined) {
    github = validateGitHubConfig(obj['github']);
  }

  let ollama: Partial<OllamaConfig> | undefined;
  if (obj['ollama'] !== undefined) {
    ollama = validateOllamaConfig(obj['ollama']);
  }

  let quality: Partial<QualityConfig> | undefined;
  if (obj['quality'] !== undefined) {
    quality = validateQualityConfig(obj['quality']);
  }

  let evidence: Partial<EvidenceConfig> | undefined;
  if (obj['evidence'] !== undefined) {
    evidence = validateEvidenceConfig(obj['evidence']);
  }

  let router: Partial<RouterConfig> | undefined;
  if (obj['router'] !== undefined) {
    router = validateRouterConfig(obj['router']);
  }

  let agentCreation: Partial<AgentCreationConfig> | undefined;
  if (obj['agentCreation'] !== undefined) {
    agentCreation = validateAgentCreationConfig(obj['agentCreation']);
  }

  let adapterDefaults: AdapterDefaultsMap | undefined;
  if (obj['adapterDefaults'] !== undefined) {
    adapterDefaults = validateAdapterDefaults(obj['adapterDefaults']);
  }

  let agentConsensus: AgentConsensusConfig | undefined;
  if (obj['agentConsensus'] !== undefined) {
    agentConsensus = validateAgentConsensusConfig(obj['agentConsensus']);
  }

  let agentOverrides: Record<string, { adapter?: AdapterType; model?: string; enabled?: boolean }> | undefined;
  if (obj['agentOverrides'] !== undefined) {
    agentOverrides = validateAgentOverrides(obj['agentOverrides']);
  }

  return {
    ...(agents !== undefined ? { agents } : {}),
    ...(github !== undefined ? { github } : {}),
    ...(ollama !== undefined ? { ollama } : {}),
    ...(quality !== undefined ? { quality } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
    ...(typeof obj['outputDir'] === 'string' ? { outputDir: obj['outputDir'] } : {}),
    ...(typeof obj['workspaceDir'] === 'string' ? { workspaceDir: obj['workspaceDir'] } : {}),
    ...(typeof obj['gitCheckpoints'] === 'boolean' ? { gitCheckpoints: obj['gitCheckpoints'] } : {}),
    ...(typeof obj['generateAgentSummary'] === 'boolean'
      ? { generateAgentSummary: obj['generateAgentSummary'] }
      : {}),
    ...(headless !== undefined ? { headless } : {}),
    ...(router !== undefined ? { router } : {}),
    ...(agentCreation !== undefined ? { agentCreation } : {}),
    ...(adapterDefaults !== undefined ? { adapterDefaults } : {}),
    ...(agentConsensus !== undefined ? { agentConsensus } : {}),
    ...(agentOverrides !== undefined ? { agentOverrides } : {}),
  } as PipelineConfig;
}
