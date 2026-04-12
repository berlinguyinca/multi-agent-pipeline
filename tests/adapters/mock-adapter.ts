import type { AgentAdapter, AdapterType, DetectInfo, RunOptions } from '../../src/types/adapter.js';

export interface MockAdapterOptions {
  type?: AdapterType;
  model?: string;
  chunks?: string[];
  delay?: number;
  shouldError?: boolean;
  errorMessage?: string;
  installed?: boolean;
}

export class MockAdapter implements AgentAdapter {
  readonly type: AdapterType;
  readonly model: string | undefined;
  private chunks: string[];
  private delay: number;
  private shouldError: boolean;
  private errorMessage: string;
  private installed: boolean;
  private abortController: AbortController | null = null;

  constructor(options: MockAdapterOptions = {}) {
    this.type = options.type ?? 'claude';
    this.model = options.model;
    this.chunks = options.chunks ?? ['Hello ', 'from ', 'mock adapter.'];
    this.delay = options.delay ?? 0;
    this.shouldError = options.shouldError ?? false;
    this.errorMessage = options.errorMessage ?? 'Mock error';
    this.installed = options.installed ?? true;
  }

  async detect(): Promise<DetectInfo> {
    return { installed: this.installed, version: '1.0.0-mock' };
  }

  async *run(_prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    this.abortController = new AbortController();
    const signal = options?.signal ?? this.abortController.signal;

    for (const chunk of this.chunks) {
      if (signal.aborted) {
        return;
      }

      if (this.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delay));
      }

      if (signal.aborted) {
        return;
      }

      if (this.shouldError) {
        throw new Error(this.errorMessage);
      }

      yield chunk;
    }
  }

  cancel(): void {
    this.abortController?.abort();
  }
}
