import type { AdapterType, DetectInfo, RunOptions } from '../types/adapter.js';
import { BaseAdapter } from './base-adapter.js';

export class CodexAdapter extends BaseAdapter {
  readonly type: AdapterType = 'codex';
  readonly model: string | undefined = undefined;

  async detect(): Promise<DetectInfo> {
    return this.detectBinary('codex');
  }

  async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    const args = ['exec', '--skip-git-repo-check', prompt];

    yield* this.streamProcess('codex', args, {
      signal: options?.signal,
      cwd: options?.cwd,
    });
  }
}
