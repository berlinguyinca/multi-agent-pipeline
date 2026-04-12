import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdapterType, RunOptions, OllamaDetectInfo } from '../types/adapter.js';
import { BaseAdapter, AdapterError } from './base-adapter.js';

const execFileAsync = promisify(execFile);

export class OllamaAdapter extends BaseAdapter {
  readonly type: AdapterType = 'ollama';
  readonly model: string | undefined;

  constructor(model?: string) {
    super();
    this.model = model;
  }

  async detect(): Promise<OllamaDetectInfo> {
    const base = await this.detectBinary('ollama');
    if (!base.installed) {
      return { ...base, models: [] };
    }

    try {
      const { stdout } = await execFileAsync('ollama', ['list']);
      const lines = stdout.trim().split('\n').slice(1); // skip header
      const models = lines
        .map((line) => line.split(/\s+/)[0])
        .filter(Boolean);
      return { ...base, models };
    } catch {
      return { ...base, models: [] };
    }
  }

  async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    if (!this.model) {
      throw new AdapterError('Ollama adapter requires a model name', this.type);
    }

    yield* this.streamProcess('ollama', ['run', this.model, prompt], {
      signal: options?.signal,
      cwd: options?.cwd,
    });
  }
}
