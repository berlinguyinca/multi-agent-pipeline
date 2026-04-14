import type { AdapterType, DetectInfo, RunOptions } from '../types/adapter.js';
import { BaseAdapter } from './base-adapter.js';

export class HermesAdapter extends BaseAdapter {
  readonly type: AdapterType = 'hermes';
  readonly model: string | undefined;

  constructor(model?: string) {
    super();
    this.model = model;
  }

  async detect(): Promise<DetectInfo> {
    return this.detectBinary('hermes');
  }

  buildArgs(prompt: string, options?: RunOptions): string[] {
    const args = ['chat', '-q', prompt, '-Q', '--yolo'];

    if (this.model) {
      args.push('--model', this.model);
    }

    if (options?.systemPrompt) {
      args.unshift('-s', options.systemPrompt);
    }

    return args;
  }

  async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    const args = this.buildArgs(prompt, options);

    yield* this.streamProcess('hermes', args, {
      signal: options?.signal,
      cwd: options?.cwd,
    });
  }
}
