import { describe, it, expect } from 'vitest';
import { MockAdapter } from './mock-adapter.js';

describe('MockAdapter', () => {
  it('yields configured chunks', async () => {
    const adapter = new MockAdapter({ chunks: ['a', 'b', 'c'] });
    const chunks: string[] = [];
    for await (const chunk of adapter.run('test')) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['a', 'b', 'c']);
  });

  it('uses default chunks when none provided', async () => {
    const adapter = new MockAdapter();
    const chunks: string[] = [];
    for await (const chunk of adapter.run('test')) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['Hello ', 'from ', 'mock adapter.']);
  });

  it('reports as installed by default', async () => {
    const adapter = new MockAdapter();
    const info = await adapter.detect();
    expect(info.installed).toBe(true);
  });

  it('can be configured as not installed', async () => {
    const adapter = new MockAdapter({ installed: false });
    const info = await adapter.detect();
    expect(info.installed).toBe(false);
  });

  it('throws on error when configured', async () => {
    const adapter = new MockAdapter({ shouldError: true, errorMessage: 'boom' });
    const gen = adapter.run('test');
    await expect(gen.next()).rejects.toThrow('boom');
  });

  it('supports cancellation via AbortSignal', async () => {
    const adapter = new MockAdapter({ chunks: ['a', 'b', 'c'], delay: 50 });
    const controller = new AbortController();

    const chunks: string[] = [];
    setTimeout(() => controller.abort(), 25);

    for await (const chunk of adapter.run('test', { signal: controller.signal })) {
      chunks.push(chunk);
    }
    // Should have yielded fewer chunks due to abort
    expect(chunks.length).toBeLessThan(3);
  });

  it('supports cancel method', async () => {
    const adapter = new MockAdapter({ chunks: ['a', 'b', 'c'], delay: 50 });

    const chunks: string[] = [];
    setTimeout(() => adapter.cancel(), 25);

    for await (const chunk of adapter.run('test')) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeLessThan(3);
  });

  it('uses configured type', () => {
    const adapter = new MockAdapter({ type: 'ollama', model: 'hermes' });
    expect(adapter.type).toBe('ollama');
    expect(adapter.model).toBe('hermes');
  });
});
