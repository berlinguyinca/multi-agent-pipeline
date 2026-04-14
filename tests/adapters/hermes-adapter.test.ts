import { describe, it, expect, beforeEach } from 'vitest';
import { HermesAdapter } from '../../src/adapters/hermes-adapter.js';

describe('HermesAdapter', () => {
  let adapter: HermesAdapter;

  beforeEach(() => {
    adapter = new HermesAdapter();
  });

  it('has correct type', () => {
    expect(adapter.type).toBe('hermes');
  });

  it('has undefined model by default', () => {
    expect(adapter.model).toBeUndefined();
  });

  it('accepts model in constructor', () => {
    const withModel = new HermesAdapter('anthropic/claude-sonnet-4');
    expect(withModel.model).toBe('anthropic/claude-sonnet-4');
  });

  it('builds correct args for basic invocation', () => {
    const args = adapter.buildArgs('Hello world');
    expect(args).toContain('chat');
    expect(args).toContain('-q');
    expect(args).toContain('Hello world');
    expect(args).toContain('-Q');
  });

  it('includes --model when model is set', () => {
    const withModel = new HermesAdapter('anthropic/claude-sonnet-4');
    const args = withModel.buildArgs('test');
    expect(args).toContain('--model');
    expect(args).toContain('anthropic/claude-sonnet-4');
  });

  it('includes --yolo flag', () => {
    const args = adapter.buildArgs('test');
    expect(args).toContain('--yolo');
  });
});
