import * as path from 'node:path';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { OllamaConfig } from '../types/config.js';
import { detectAllAdapters } from './detect.js';
import { ensureOllamaReadyForConfigs } from './ollama-runtime.js';

export function recommendOllamaModel(agent: Pick<AgentDefinition, 'name' | 'description' | 'handles'>): string {
  const haystack = `${agent.name}\n${agent.description}\n${agent.handles}`.toLowerCase();
  if (/(sql|database|dba|query|migration)/.test(haystack)) return 'deepseek-coder:latest';
  if (/(design|ux|web|presentation|visual)/.test(haystack)) return 'qwen2.5:14b';
  if (/(research|analysis|judge|compare|qa|review)/.test(haystack)) return 'gemma4:26b';
  if (/(code|implement|build|fix|test)/.test(haystack)) return 'deepseek-coder:latest';
  return 'gemma4:26b';
}

export async function listInstalledOllamaModels(host?: string): Promise<string[]> {
  const detection = await detectAllAdapters(host);
  return detection.ollama.models;
}

export async function syncReferencedOllamaModels(
  agents: Iterable<Pick<AgentDefinition, 'adapter' | 'model'>>,
  ollama?: string | OllamaConfig,
): Promise<void> {
  const host = typeof ollama === 'string' ? ollama : ollama?.host;
  await ensureOllamaReadyForConfigs(
    [...agents]
      .filter((agent) => agent.adapter === 'ollama' && agent.model)
      .map((agent) => ({
        type: 'ollama' as const,
        model: agent.model,
        host,
        ...(typeof ollama === 'object'
          ? {
              contextLength: ollama.contextLength,
              numParallel: ollama.numParallel,
              maxLoadedModels: ollama.maxLoadedModels,
            }
          : {}),
      })),
  );
}
