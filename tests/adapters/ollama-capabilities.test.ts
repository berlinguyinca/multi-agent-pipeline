import { describe, expect, it } from 'vitest';
import { probeOllamaConcurrencyCapacity, resetOllamaCapabilityProbeCacheForTests } from '../../src/adapters/ollama-capabilities.js';

function streamLineAfter(ms: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(encoder.encode('{"message":{"content":"OK"}}\n'));
        controller.close();
      }, ms);
    },
  });
}

describe('probeOllamaConcurrencyCapacity', () => {
  it('detects parallel capacity up to the requested maximum', async () => {
    resetOllamaCapabilityProbeCacheForTests();
    const fetchFn = async () => ({
      ok: true,
      body: streamLineAfter(1),
      text: async () => '',
    }) as Response;

    const result = await probeOllamaConcurrencyCapacity({
      model: 'gemma4',
      maxParallel: 3,
      timeoutMs: 100,
      fetchFn: fetchFn as typeof fetch,
    });

    expect(result.maxParallel).toBe(3);
  });

  it('falls back to one when concurrent probes do not make progress', async () => {
    resetOllamaCapabilityProbeCacheForTests();
    let active = 0;
    const fetchFn = async () => {
      active += 1;
      const delay = active > 1 ? 80 : 1;
      setTimeout(() => { active -= 1; }, delay);
      return {
        ok: true,
        body: streamLineAfter(delay),
        text: async () => '',
      } as Response;
    };

    const result = await probeOllamaConcurrencyCapacity({
      model: 'gemma4',
      maxParallel: 3,
      timeoutMs: 40,
      fetchFn: fetchFn as typeof fetch,
    });

    expect(result.maxParallel).toBe(1);
  });

  it('uses supplied model list when probing concurrent multi-model capacity', async () => {
    resetOllamaCapabilityProbeCacheForTests();
    const requestedModels: string[] = [];
    const fetchFn = async (_url: URL | RequestInfo, init?: RequestInit) => {
      requestedModels.push(JSON.parse(String(init?.body)).model);
      return {
        ok: true,
        body: streamLineAfter(1),
        text: async () => '',
      } as Response;
    };

    const result = await probeOllamaConcurrencyCapacity({
      model: 'gemma4',
      models: ['gemma4', 'qwen3', 'llama3'],
      maxParallel: 3,
      timeoutMs: 100,
      fetchFn: fetchFn as typeof fetch,
    });

    expect(result.maxParallel).toBe(3);
    expect(requestedModels).toEqual(expect.arrayContaining(['gemma4', 'qwen3', 'llama3']));
  });
});
