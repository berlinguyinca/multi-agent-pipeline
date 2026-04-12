import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useAgent } from '../../../src/tui/hooks/useAgent.js';
import type { AgentAdapter, DetectInfo, RunOptions } from '../../../src/types/adapter.js';

function makeMockAdapter(chunks: string[] = ['hello', ' world']): AgentAdapter {
  return {
    type: 'claude',
    model: 'mock',
    async detect(): Promise<DetectInfo> {
      return { installed: true };
    },
    async *run(_prompt: string, _options?: RunOptions): AsyncGenerator<string, void, void> {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
    cancel() {},
  };
}

function TestAgent({ adapter }: { adapter: AgentAdapter }) {
  const { output, streaming, error } = useAgent(adapter);
  return React.createElement(Text, null, JSON.stringify({ output, streaming, error }));
}

describe('useAgent', () => {
  it('initializes with empty state', () => {
    const adapter = makeMockAdapter();
    const { lastFrame } = render(React.createElement(TestAgent, { adapter }));
    const state = JSON.parse(lastFrame()!);
    expect(state.output).toBe('');
    expect(state.streaming).toBe(false);
    expect(state.error).toBeNull();
  });

  it('has correct adapter shape', () => {
    const adapter = makeMockAdapter(['hello']);
    expect(adapter.type).toBe('claude');
    expect(typeof adapter.run).toBe('function');
    expect(typeof adapter.cancel).toBe('function');
  });
});
