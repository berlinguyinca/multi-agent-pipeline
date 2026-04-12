import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parse as parseYaml } from 'yaml';
import type { PipelineConfig } from '../types/config.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { validateConfig } from './schema.js';

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
  return {
    agents: {
      spec: override.agents?.spec ?? base.agents.spec,
      review: override.agents?.review ?? base.agents.review,
      execute: override.agents?.execute ?? base.agents.execute,
    },
    outputDir: override.outputDir ?? base.outputDir,
    gitCheckpoints: override.gitCheckpoints ?? base.gitCheckpoints,
  };
}

export async function loadConfig(configPath?: string): Promise<PipelineConfig> {
  const resolvedPath = await findConfigFile(configPath);

  if (resolvedPath === null) {
    return { ...DEFAULT_CONFIG, agents: { ...DEFAULT_CONFIG.agents } };
  }

  const content = await fs.readFile(resolvedPath, 'utf-8');
  const parsed: unknown = parseYaml(content);

  // Validate the parsed config (throws on invalid)
  const validated = validateConfig(parsed);

  return deepMerge(DEFAULT_CONFIG, validated);
}
