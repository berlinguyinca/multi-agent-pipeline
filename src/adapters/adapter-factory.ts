import type { AdapterConfig, AgentAdapter } from '../types/adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { HermesAdapter } from './hermes-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';

export function createAdapter(config: AdapterConfig): AgentAdapter {
  switch (config.type) {
    case 'claude':
      return new ClaudeAdapter();
    case 'codex':
      return new CodexAdapter();
    case 'ollama':
      return new OllamaAdapter(config.model, config.host);
    case 'hermes':
      return new HermesAdapter(config.model);
    default: {
      const _exhaustive: never = config.type;
      throw new Error(`Unknown adapter type: ${_exhaustive}`);
    }
  }
}
