import type { AdapterType, DetectInfo, RunOptions } from '../types/adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { ensureOllamaReady, type OllamaServerOptions } from './ollama-runtime.js';

export function normalizeHuggingFaceOllamaModel(model: string): string {
  const trimmed = model.trim();
  if (trimmed.startsWith('hf.co/')) return trimmed;
  if (trimmed.startsWith('huggingface.co/')) return `hf.co/${trimmed.slice('huggingface.co/'.length)}`;
  return `hf.co/${trimmed}`;
}

export class HuggingFaceAdapter {
  readonly type: AdapterType = 'huggingface';
  readonly model: string | undefined;
  private readonly host: string | undefined;
  private readonly options: OllamaServerOptions | undefined;
  private delegate: OllamaAdapter | null = null;

  constructor(model?: string, host?: string, options?: OllamaServerOptions) {
    this.model = model ? normalizeHuggingFaceOllamaModel(model) : undefined;
    this.host = host;
    this.options = options;
  }

  async detect(): Promise<DetectInfo> {
    return new OllamaAdapter(this.model, this.host, this.options).detect();
  }

  async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    if (!this.model) {
      throw new Error('HuggingFaceAdapter requires a model such as hf.co/org/model or org/model');
    }
    await ensureOllamaReady(this.model, this.host, this.options);
    this.delegate = new OllamaAdapter(this.model, this.host, this.options);
    yield* this.delegate.run(prompt, options);
  }

  cancel(): void {
    this.delegate?.cancel();
  }
}
