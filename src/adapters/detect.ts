import type { DetectionResult } from '../types/adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { HermesAdapter } from './hermes-adapter.js';
import { HuggingFaceAdapter } from './huggingface-adapter.js';
import { MetadataAdapter } from './metadata-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';

export async function detectAllAdapters(ollamaHost?: string): Promise<DetectionResult> {
  const claude = new ClaudeAdapter();
  const codex = new CodexAdapter();
  const ollama = new OllamaAdapter(undefined, ollamaHost);
  const hermes = new HermesAdapter();
  const metadata = new MetadataAdapter();
  const huggingface = new HuggingFaceAdapter(undefined, ollamaHost);

  const [claudeInfo, codexInfo, ollamaInfo, hermesInfo, metadataInfo, huggingfaceInfo] = await Promise.all([
    claude.detect(),
    codex.detect(),
    ollama.detect(),
    hermes.detect(),
    metadata.detect(),
    huggingface.detect(),
  ]);

  return {
    claude: claudeInfo,
    codex: codexInfo,
    ollama: ollamaInfo as DetectionResult['ollama'],
    hermes: hermesInfo,
    metadata: metadataInfo,
    huggingface: huggingfaceInfo,
  };
}
