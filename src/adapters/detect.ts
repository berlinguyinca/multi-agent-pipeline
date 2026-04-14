import type { DetectionResult } from '../types/adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { HermesAdapter } from './hermes-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';

export async function detectAllAdapters(ollamaHost?: string): Promise<DetectionResult> {
  const claude = new ClaudeAdapter();
  const codex = new CodexAdapter();
  const ollama = new OllamaAdapter(undefined, ollamaHost);
  const hermes = new HermesAdapter();

  const [claudeInfo, codexInfo, ollamaInfo, hermesInfo] = await Promise.all([
    claude.detect(),
    codex.detect(),
    ollama.detect(),
    hermes.detect(),
  ]);

  return {
    claude: claudeInfo,
    codex: codexInfo,
    ollama: ollamaInfo as DetectionResult['ollama'],
    hermes: hermesInfo,
  };
}
