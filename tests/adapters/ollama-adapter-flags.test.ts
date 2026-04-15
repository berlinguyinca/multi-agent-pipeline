import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  ensure: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
  execFile: vi.fn(),
}));

vi.mock('../../src/adapters/ollama-runtime.js', () => ({
  ensureOllamaReadyForConfigs: mocks.ensure,
}));

const originalFetch = globalThis.fetch;
const { OllamaAdapter } = await import('../../src/adapters/ollama-adapter.js');

describe('OllamaAdapter run behavior', () => {
  beforeEach(() => {
    mocks.spawn.mockReset();
    mocks.ensure.mockReset();
    mocks.fetch.mockReset();
    mocks.ensure.mockResolvedValue(undefined);
    globalThis.fetch = mocks.fetch as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses the Ollama API for JSON routing requests', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"x","dependsOn":[]}]}' } }),
      text: async () => '',
    });

    const adapter = new OllamaAdapter('gemma4');
    const chunks: string[] = [];

    for await (const chunk of adapter.run('route this task', {
      responseFormat: 'json',
      hideThinking: true,
      think: false,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"x","dependsOn":[]}]}']);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).not.toHaveBeenCalled();

    const [url, init] = mocks.fetch.mock.calls[0]!;
    expect(String(url)).toContain('/api/chat');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      model: 'gemma4',
      stream: false,
      options: { temperature: 0 },
    });
    expect(body.messages).toEqual([
      {
        role: 'system',
        content: expect.stringContaining('valid JSON'),
      },
      {
        role: 'user',
        content: 'route this task',
      },
    ]);
    expect(body.format).toMatchObject({
      type: 'object',
    });
  });

  it('surfaces a friendly abort error for structured API requests', async () => {
    const abortErr = new Error('This operation was aborted.');
    (abortErr as Error & { name: string }).name = 'AbortError';
    mocks.fetch.mockRejectedValue(abortErr);

    const adapter = new OllamaAdapter('gemma4');

    await expect(
      adapter.run('route this task', { responseFormat: 'json' }).next(),
    ).rejects.toThrow('aborted while generating output');
  });

  it('still uses the CLI stream for non-JSON requests', async () => {
    const closeHandlers: Array<(code: number | null) => void> = [];

    mocks.spawn.mockImplementation((_binary, args) => {
      const child = {
        stdin: { end: vi.fn() },
        stdout: (async function* () {
          yield Buffer.from('plain text');
        })(),
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (code: number | null) => void) => {
          if (event === 'close') {
            closeHandlers.push(handler);
            setImmediate(() => handler(0));
          }
          return child;
        }),
        kill: vi.fn(),
        pid: 1234,
      } as any;
      return child;
    });

    const adapter = new OllamaAdapter('gemma4');
    const chunks: string[] = [];

    for await (const chunk of adapter.run('route this task')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['plain text']);
    expect(mocks.spawn).toHaveBeenCalledWith(
      'ollama',
      ['run', 'gemma4', 'route this task'],
      expect.objectContaining({}),
    );
    expect(closeHandlers.length).toBeGreaterThan(0);
  });
});
