import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import type { AdapterType } from '../types/adapter.js';

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
  enabled?: boolean;
}

export async function ensureOllamaReadyForConfigs(
  configs: OllamaRuntimeConfig[],
): Promise<void> {
  const required = new Map<string, { model: string; host?: string }>();

  for (const config of configs) {
    if (config.enabled === false || config.type !== 'ollama' || !config.model) continue;
    required.set(`${config.host ?? 'default'}:${config.model}`, {
      model: config.model,
      host: config.host,
    });
  }

  for (const config of required.values()) {
    await ensureOllamaReady(config.model, config.host);
  }
}

export async function ensureOllamaReady(model: string, host?: string): Promise<void> {
  const key = `${host ?? 'default'}:${model}`;
  if (preparedModels.has(key)) return;

  await assertOllamaBinary();

  if (!(await canListModels(host))) {
    startOllamaServe(host);
    await waitForOllamaServer(host);
  }

  await pullModel(model, host);
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

async function canListModels(host?: string): Promise<boolean> {
  try {
    await execFileAsync('ollama', ['list'], { env: buildEnv(host) });
    return true;
  } catch {
    return false;
  }
}

function startOllamaServe(host?: string): void {
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    env: buildEnv(host),
  });
  child.unref();
}

async function waitForOllamaServer(host?: string): Promise<void> {
  const attempts = 10;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await canListModels(host)) return;
    await delay(250);
  }

  throw new Error('Ollama server did not become available after starting `ollama serve`');
}

async function pullModel(model: string, host?: string): Promise<void> {
  try {
    await execFileAsync('ollama', ['pull', model], { env: buildEnv(host) });
  } catch (err: unknown) {
    const message = errorMessage(err);
    throw new Error(`Failed to pull or update Ollama model "${model}": ${message}`);
  }
}

function buildEnv(host?: string): NodeJS.ProcessEnv {
  return host ? { ...process.env, OLLAMA_HOST: host } : process.env;
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
