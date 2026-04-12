import type { AdapterType, DetectInfo, RunOptions } from '../types/adapter.js';
import { BaseAdapter } from './base-adapter.js';

export class ClaudeAdapter extends BaseAdapter {
  readonly type: AdapterType = 'claude';
  readonly model: string | undefined = undefined;

  async detect(): Promise<DetectInfo> {
    return this.detectBinary('claude');
  }

  async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    const args = ['--print', prompt];

    if (options?.systemPrompt) {
      args.unshift('--append-system-prompt', options.systemPrompt);
    }

    yield* this.streamProcess('claude', args, {
      signal: options?.signal,
      cwd: options?.cwd,
    });
  }
}
