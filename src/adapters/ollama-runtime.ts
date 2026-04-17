import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import type { AdapterType } from '../types/adapter.js';
import {
  DEFAULT_OLLAMA_CONTEXT_LENGTH,
  DEFAULT_OLLAMA_MAX_LOADED_MODELS,
  DEFAULT_OLLAMA_NUM_PARALLEL,
} from '../config/ollama-defaults.js';

const execFileAsync = promisify(execFile);
const preparedModels = new Set<string>();

interface ExecFailure extends Error {
  stdout?: string;
  stderr?: string;
}

export interface OllamaRuntimeConfig {
  type: AdapterType;
  model?: string;
  host?: string;
  contextLength?: number;
  numParallel?: number;
  maxLoadedModels?: number;
  enabled?: boolean;
}

export interface OllamaServerOptions {
  contextLength?: number;
  numParallel?: number;
  maxLoadedModels?: number;
}

export async function ensureOllamaReadyForConfigs(
  configs: OllamaRuntimeConfig[],
): Promise<void> {
  const required = new Map<string, { model: string; host?: string; options: Required<OllamaServerOptions> }>();

  for (const config of configs) {
    if (config.enabled === false || config.type !== 'ollama' || !config.model) continue;
    const options = normalizeOllamaServerOptions(config);
    required.set(runtimeKey(config.model, config.host, options), {
      model: config.model,
      host: config.host,
      options,
    });
  }

  for (const config of required.values()) {
    await ensureOllamaReady(config.model, config.host, config.options);
  }
}

export async function ensureOllamaReady(
  model: string,
  host?: string,
  options?: OllamaServerOptions,
): Promise<void> {
  const resolvedOptions = normalizeOllamaServerOptions(options);
  const key = runtimeKey(model, host, resolvedOptions);
  if (preparedModels.has(key)) return;

  await assertOllamaBinary();

  if (!(await canListModels(host, resolvedOptions))) {
    startOllamaServe(host, resolvedOptions);
    await waitForOllamaServer(host, resolvedOptions);
  }

  await pullModel(model, host, resolvedOptions);
  preparedModels.add(key);
}

export function resetOllamaRuntimeStateForTests(): void {
  preparedModels.clear();
}

async function assertOllamaBinary(): Promise<void> {
  try {
    await execFileAsync('ollama', ['--version']);
  } catch (err: unknown) {
    const message = errorMessage(err);
    throw new Error(`Ollama is required but the ollama binary is unavailable: ${message}`);
  }
}

async function canListModels(host?: string, options?: OllamaServerOptions): Promise<boolean> {
  try {
    await execFileAsync('ollama', ['list'], { env: buildOllamaEnv(host, options) });
    return true;
  } catch {
    return false;
  }
}

function startOllamaServe(host?: string, options?: OllamaServerOptions): void {
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    env: buildOllamaEnv(host, options),
  });
  child.unref();
}

async function waitForOllamaServer(host?: string, options?: OllamaServerOptions): Promise<void> {
  const attempts = 10;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await canListModels(host, options)) return;
    await delay(250);
  }

  throw new Error('Ollama server did not become available after starting `ollama serve`');
}

async function pullModel(model: string, host?: string, options?: OllamaServerOptions): Promise<void> {
  try {
    await execFileAsync('ollama', ['pull', model], { env: buildOllamaEnv(host, options) });
  } catch (err: unknown) {
    const message = errorMessage(err);
    throw new Error(`Failed to pull or update Ollama model "${model}": ${message}`);
  }
}

export function buildOllamaEnv(
  host?: string,
  options?: OllamaServerOptions,
): NodeJS.ProcessEnv {
  const resolvedOptions = normalizeOllamaServerOptions(options);
  return {
    ...process.env,
    ...(host ? { OLLAMA_HOST: host } : {}),
    OLLAMA_CONTEXT_LENGTH: String(resolvedOptions.contextLength),
    OLLAMA_NUM_PARALLEL: String(resolvedOptions.numParallel),
    OLLAMA_MAX_LOADED_MODELS: String(resolvedOptions.maxLoadedModels),
  };
}

function normalizeOllamaServerOptions(
  options?: OllamaServerOptions,
): Required<OllamaServerOptions> {
  return {
    contextLength: options?.contextLength ?? DEFAULT_OLLAMA_CONTEXT_LENGTH,
    numParallel: options?.numParallel ?? DEFAULT_OLLAMA_NUM_PARALLEL,
    maxLoadedModels: options?.maxLoadedModels ?? DEFAULT_OLLAMA_MAX_LOADED_MODELS,
  };
}

function runtimeKey(
  model: string,
  host: string | undefined,
  options: Required<OllamaServerOptions>,
): string {
  return [
    host ?? 'default',
    model,
    options.contextLength,
    options.numParallel,
    options.maxLoadedModels,
  ].join(':');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const withOutput = err as ExecFailure;
    const output = withOutput.stderr || withOutput.stdout;
    return output ? output.trim() : err.message;
  }
  return String(err);
}
