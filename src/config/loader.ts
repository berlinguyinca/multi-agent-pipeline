import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parse as parseYaml } from 'yaml';
import type { PipelineConfig } from '../types/config.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { validateConfig } from './schema.js';
import { validateDurationRelationship } from '../utils/duration.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findConfigFile(providedPath?: string): Promise<string | null> {
  if (providedPath !== undefined) {
    if (await fileExists(providedPath)) {
      return providedPath;
    }
    return null;
  }

  // Look in cwd
  const cwdConfig = path.join(process.cwd(), 'pipeline.yaml');
  if (await fileExists(cwdConfig)) {
    return cwdConfig;
  }

  // Look in ~/.map/
  const homeConfig = path.join(os.homedir(), '.map', 'pipeline.yaml');
  if (await fileExists(homeConfig)) {
    return homeConfig;
  }

  return null;
}

function deepMerge(base: PipelineConfig, override: Partial<PipelineConfig>): PipelineConfig {
  const adapterDefaults = { ...base.adapterDefaults };
  for (const [adapter, defaults] of Object.entries(override.adapterDefaults ?? {})) {
    adapterDefaults[adapter as keyof typeof adapterDefaults] = {
      ...(base.adapterDefaults[adapter as keyof typeof adapterDefaults] ?? {}),
      ...defaults,
    };
  }

  return {
    agents: {
      spec: override.agents?.spec ?? base.agents.spec,
      review: override.agents?.review ?? base.agents.review,
      qa: override.agents?.qa ?? base.agents.qa,
      execute: override.agents?.execute ?? base.agents.execute,
      docs: override.agents?.docs ?? base.agents.docs,
    },
    github: {
      token: override.github?.token ?? base.github.token,
    },
    ollama: {
      host: override.ollama?.host ?? base.ollama.host,
      contextLength: override.ollama?.contextLength ?? base.ollama.contextLength,
      numParallel: override.ollama?.numParallel ?? base.ollama.numParallel,
      maxLoadedModels: override.ollama?.maxLoadedModels ?? base.ollama.maxLoadedModels,
    },
    quality: {
      maxSpecQaIterations:
        override.quality?.maxSpecQaIterations ?? base.quality.maxSpecQaIterations,
      maxCodeQaIterations:
        override.quality?.maxCodeQaIterations ?? base.quality.maxCodeQaIterations,
    },
    evidence: {
      ...base.evidence,
      ...override.evidence,
      requiredAgents: [
        ...(override.evidence?.requiredAgents ?? base.evidence.requiredAgents),
      ],
    },
    outputDir: override.outputDir ?? base.outputDir,
    workspaceDir: override.workspaceDir ?? base.workspaceDir,
    gitCheckpoints: override.gitCheckpoints ?? base.gitCheckpoints,
    generateAgentSummary: override.generateAgentSummary ?? base.generateAgentSummary,
    headless: {
      totalTimeoutMs: override.headless?.totalTimeoutMs ?? base.headless.totalTimeoutMs,
      inactivityTimeoutMs:
        override.headless?.inactivityTimeoutMs ?? base.headless.inactivityTimeoutMs,
      pollIntervalMs: override.headless?.pollIntervalMs ?? base.headless.pollIntervalMs,
    },
    router: {
      adapter: override.router?.adapter ?? base.router.adapter,
      model: override.router?.model ?? base.router.model,
      maxSteps: override.router?.maxSteps ?? base.router.maxSteps,
      timeoutMs: override.router?.timeoutMs ?? base.router.timeoutMs,
      stepTimeoutMs: override.router?.stepTimeoutMs ?? base.router.stepTimeoutMs,
      maxStepRetries: override.router?.maxStepRetries ?? base.router.maxStepRetries,
      retryDelayMs: override.router?.retryDelayMs ?? base.router.retryDelayMs,
      consensus: override.router?.consensus ?? base.router.consensus,
    },
    agentCreation: {
      adapter: override.agentCreation?.adapter ?? base.agentCreation.adapter,
      model: override.agentCreation?.model ?? base.agentCreation.model,
    },
    adapterDefaults,
    agentConsensus: {
      ...base.agentConsensus,
      ...override.agentConsensus,
      perAgent: {
        ...base.agentConsensus.perAgent,
        ...override.agentConsensus?.perAgent,
      },
      outputTypes: [
        ...(override.agentConsensus?.outputTypes ?? base.agentConsensus.outputTypes),
      ],
      fileOutputs: {
        ...base.agentConsensus.fileOutputs,
        ...override.agentConsensus?.fileOutputs,
        verificationCommands: [
          ...(override.agentConsensus?.fileOutputs?.verificationCommands ??
            base.agentConsensus.fileOutputs.verificationCommands),
        ],
      },
    },
    agentOverrides: {
      ...base.agentOverrides,
      ...override.agentOverrides,
    },
    security: {
      enabled: override.security?.enabled ?? base.security.enabled,
      maxRemediationRetries:
        override.security?.maxRemediationRetries ?? base.security.maxRemediationRetries,
      adapter: override.security?.adapter ?? base.security.adapter,
      model: override.security?.model ?? base.security.model,
      staticPatternsEnabled:
        override.security?.staticPatternsEnabled ?? base.security.staticPatternsEnabled,
      llmReviewEnabled: override.security?.llmReviewEnabled ?? base.security.llmReviewEnabled,
    },
  };
}

export async function loadConfig(configPath?: string): Promise<PipelineConfig> {
  const resolvedPath = await findConfigFile(configPath);

  if (resolvedPath === null) {
    return {
      ...DEFAULT_CONFIG,
      agents: { ...DEFAULT_CONFIG.agents },
      github: { ...DEFAULT_CONFIG.github },
      ollama: { ...DEFAULT_CONFIG.ollama },
      quality: { ...DEFAULT_CONFIG.quality },
      evidence: {
        ...DEFAULT_CONFIG.evidence,
        requiredAgents: [...DEFAULT_CONFIG.evidence.requiredAgents],
      },
      generateAgentSummary: DEFAULT_CONFIG.generateAgentSummary,
      headless: { ...DEFAULT_CONFIG.headless },
      router: { ...DEFAULT_CONFIG.router },
      agentCreation: { ...DEFAULT_CONFIG.agentCreation },
      adapterDefaults: Object.fromEntries(
        Object.entries(DEFAULT_CONFIG.adapterDefaults).map(([adapter, defaults]) => [
          adapter,
          { ...defaults },
        ]),
      ) as PipelineConfig['adapterDefaults'],
      agentConsensus: {
        ...DEFAULT_CONFIG.agentConsensus,
        perAgent: { ...DEFAULT_CONFIG.agentConsensus.perAgent },
        outputTypes: [...DEFAULT_CONFIG.agentConsensus.outputTypes],
        fileOutputs: {
          ...DEFAULT_CONFIG.agentConsensus.fileOutputs,
          verificationCommands: [
            ...DEFAULT_CONFIG.agentConsensus.fileOutputs.verificationCommands,
          ],
        },
      },
      agentOverrides: { ...DEFAULT_CONFIG.agentOverrides },
      security: { ...DEFAULT_CONFIG.security },
    };
  }

  const content = await fs.readFile(resolvedPath, 'utf-8');
  const parsed: unknown = parseYaml(content);

  // Validate the parsed config (throws on invalid)
  const validated = validateConfig(parsed);

  const merged = deepMerge(DEFAULT_CONFIG, validated);
  validateDurationRelationship(
    merged.headless.totalTimeoutMs,
    merged.headless.inactivityTimeoutMs,
    merged.headless.pollIntervalMs,
  );

  return merged;
}
