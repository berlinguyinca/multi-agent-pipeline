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
  buildOllamaEnv: (host?: string) => (host ? { ...process.env, OLLAMA_HOST: host } : process.env),
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
      body: streamLines([
        '{"message":{"content":"{\\"kind\\":\\"plan\\",\\"plan\\":["}}\n',
        '{"message":{"content":"{\\"id\\":\\"step-1\\",\\"agent\\":\\"researcher\\",\\"task\\":\\"x\\",\\"dependsOn\\":[]}"}}\n',
        '{"message":{"content":"]}"},"done":true}\n',
      ]),
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

    expect(chunks).toEqual([
      '{"kind":"plan","plan":[',
      '{"id":"step-1","agent":"researcher","task":"x","dependsOn":[]}',
      ']}',
    ]);
    expect(chunks.join('')).toBe('{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"x","dependsOn":[]}]}');
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
      stream: true,
      think: false,
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

  it('streams deterministic API requests so callers receive progress before completion', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      body: streamLines([
        '{"message":{"content":"first "}}\n',
        '{"message":{"content":"second"}}\n',
        '{"done":true}\n',
      ]),
      text: async () => '',
    });

    const adapter = new OllamaAdapter('gemma4');
    const chunks: string[] = [];

    for await (const chunk of adapter.run('classify this', {
      temperature: 0,
      seed: 42,
      think: false,
      hideThinking: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['first ', 'second']);
    const body = JSON.parse((mocks.fetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      model: 'gemma4',
      stream: true,
      think: false,
      options: { temperature: 0, seed: 42 },
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
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

function streamLines(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}
