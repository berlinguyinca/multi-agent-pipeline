import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdapterType, RunOptions, OllamaDetectInfo } from '../types/adapter.js';
import { BaseAdapter, AdapterError } from './base-adapter.js';
import { buildOllamaEnv, ensureOllamaReadyForConfigs } from './ollama-runtime.js';
import { isAbortError } from '../utils/error.js';

const execFileAsync = promisify(execFile);

export class OllamaAdapter extends BaseAdapter {
  readonly type: AdapterType = 'ollama';
  readonly model: string | undefined;
  readonly host: string | undefined;
  readonly contextLength: number | undefined;
  readonly numParallel: number | undefined;
  readonly maxLoadedModels: number | undefined;

  constructor(
    model?: string,
    host?: string,
    options?: { contextLength?: number; numParallel?: number; maxLoadedModels?: number },
  ) {
    super();
    this.model = model;
    this.host = host;
    this.contextLength = options?.contextLength;
    this.numParallel = options?.numParallel;
    this.maxLoadedModels = options?.maxLoadedModels;
  }

  async detect(): Promise<OllamaDetectInfo> {
    const base = await this.detectBinary('ollama');
    if (!base.installed) {
      return { ...base, models: [] };
    }

    try {
      const { stdout } = await execFileAsync('ollama', ['list'], {
        env: this.buildEnv(),
      });
      const lines = stdout.trim().split('\n').slice(1); // skip header
      const models = lines
        .map((line) => line.split(/\s+/)[0])
        .filter(Boolean);
      return { ...base, models };
    } catch {
      return { ...base, models: [] };
    }
  }

  async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    if (!this.model) {
      throw new AdapterError('Ollama adapter requires a model name', this.type);
    }

    await ensureOllamaReadyForConfigs([
      {
        type: this.type,
        model: this.model,
        host: this.host,
        contextLength: this.contextLength,
        numParallel: this.numParallel,
        maxLoadedModels: this.maxLoadedModels,
      },
    ]);

    const fullPrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n---\n\n${prompt}`
      : prompt;

    if (
      options?.responseFormat === 'json' ||
      options?.temperature !== undefined ||
      options?.seed !== undefined
    ) {
      yield* this.streamViaChatApi(fullPrompt, options);
      return;
    }

    const args = ['run', this.model];
    if (options?.responseFormat) {
      args.push('--format', options.responseFormat);
    }
    if (options?.hideThinking) {
      args.push('--hidethinking');
    }
    if (options?.think !== undefined) {
      args.push('--think', String(options.think));
    }
    args.push(fullPrompt);

    yield* this.streamProcess('ollama', args, {
      signal: options?.signal,
      cwd: options?.cwd,
      env: this.buildEnv(),
    });
  }

  private async *streamViaChatApi(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    const baseUrl = new URL(this.host ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434');
    const url = new URL('/api/chat', baseUrl);
    const generationOptions: Record<string, number> = {};
    if (options?.temperature !== undefined) {
      generationOptions['temperature'] = options.temperature;
    }
    if (options?.seed !== undefined) {
      generationOptions['seed'] = options.seed;
    }
    if (Object.keys(generationOptions).length === 0) {
      generationOptions['temperature'] = 0;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: options?.signal,
        body: JSON.stringify({
          model: this.model,
          messages: buildChatMessages(prompt, options?.responseFormat === 'json'),
          stream: true,
          ...(options?.think !== undefined ? { think: options.think } : {}),
          ...(options?.responseFormat === 'json' ? { format: ROUTER_OUTPUT_SCHEMA } : {}),
          options: generationOptions,
        }),
      });
    } catch (err: unknown) {
      if (isAbortError(err)) {
        throw new AdapterError(
          `Ollama request was aborted while generating output for model "${this.model}"`,
          this.type,
        );
      }
      throw err;
    }

    if (!response.ok) {
      throw new AdapterError(
        `Ollama API request failed with status ${response.status}: ${await response.text()}`,
        this.type,
      );
    }

    if (!response.body) {
      throw new AdapterError('Ollama API response did not include a stream body', this.type);
    }

    try {
      for await (const content of readOllamaStream(response.body)) {
        yield content;
      }
    } catch (err: unknown) {
      if (isAbortError(err)) {
        throw new AdapterError(
          `Ollama request was aborted while generating output for model "${this.model}"`,
          this.type,
        );
      }
      throw err;
    }
  }

  private buildEnv(): NodeJS.ProcessEnv {
    return buildOllamaEnv(this.host, {
      contextLength: this.contextLength,
      numParallel: this.numParallel,
      maxLoadedModels: this.maxLoadedModels,
    });
  }
}

async function* readOllamaStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const content = parseOllamaStreamLine(line);
        if (content) yield content;
      }
    }

    buffer += decoder.decode();
    const content = parseOllamaStreamLine(buffer);
    if (content) yield content;
  } finally {
    reader.releaseLock();
  }
}

function parseOllamaStreamLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';

  let payload: {
    message?: { content?: unknown };
    response?: unknown;
    error?: unknown;
  };
  try {
    payload = JSON.parse(trimmed) as typeof payload;
  } catch (err: unknown) {
    throw new AdapterError(`Ollama API returned malformed stream JSON: ${trimmed}`, 'ollama');
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    throw new AdapterError(`Ollama API stream failed: ${payload.error}`, 'ollama');
  }

  if (typeof payload.message?.content === 'string') {
    return payload.message.content;
  }

  if (typeof payload.response === 'string') {
    return payload.response;
  }

  return '';
}

const ROUTER_OUTPUT_SCHEMA = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'plan' },
        plan: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1 },
              agent: { type: 'string', minLength: 1 },
              task: { type: 'string', minLength: 1, maxLength: 320 },
              dependsOn: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['id', 'agent', 'task', 'dependsOn'],
            additionalProperties: false,
          },
        },
      },
      required: ['kind', 'plan'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'no-match' },
        reason: { type: 'string', minLength: 1 },
        suggestedAgent: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            description: { type: 'string', minLength: 1 },
          },
          required: ['name', 'description'],
          additionalProperties: false,
        },
      },
      required: ['kind', 'reason'],
      additionalProperties: false,
    },
  ],
} as const;

function buildChatMessages(prompt: string, jsonMode: boolean): Array<{ role: 'system' | 'user'; content: string }> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

  if (jsonMode) {
    messages.push({
      role: 'system',
      content:
        'Return only valid JSON that matches the provided schema. Do not include reasoning, markdown, or commentary.',
    });
  }

  messages.push({ role: 'user', content: prompt });
  return messages;
}
