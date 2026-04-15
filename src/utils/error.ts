import type { AdapterType } from '../types/adapter.js';

export class MapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapError';
  }
}

export class ConfigError extends MapError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class CheckpointError extends MapError {
  constructor(message: string) {
    super(message);
    this.name = 'CheckpointError';
  }
}

export class AdapterNotFoundError extends MapError {
  constructor(
    public readonly adapterType: AdapterType,
    public readonly binaryName: string,
  ) {
    super(
      `${binaryName} not found. Install it to use the ${adapterType} adapter.\n` +
        installHint(adapterType),
    );
    this.name = 'AdapterNotFoundError';
  }
}

export class AllAdaptersExhaustedError extends MapError {
  constructor(public readonly adapters: AdapterType[]) {
    super(
      `All adapters in failover chain exhausted: ${adapters.join(' → ')}`,
    );
    this.name = 'AllAdaptersExhaustedError';
  }
}

export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.message.toLowerCase().includes('aborted');
}

function installHint(type: AdapterType): string {
  switch (type) {
    case 'claude':
      return 'Install: npm install -g @anthropic-ai/claude-code';
    case 'codex':
      return 'Install: npm install -g @openai/codex';
    case 'ollama':
      return 'Install: https://ollama.com/download';
    case 'hermes':
      return 'Install Hermes CLI and ensure the hermes binary is on PATH';
  }
}
