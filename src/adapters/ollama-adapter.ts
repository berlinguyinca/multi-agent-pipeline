import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdapterType, RunOptions, OllamaDetectInfo } from '../types/adapter.js';
import { BaseAdapter, AdapterError } from './base-adapter.js';
import { ensureOllamaReadyForConfigs } from './ollama-runtime.js';

const execFileAsync = promisify(execFile);

export class OllamaAdapter extends BaseAdapter {
  readonly type: AdapterType = 'ollama';
  readonly model: string | undefined;
  readonly host: string | undefined;

  constructor(model?: string, host?: string) {
    super();
    this.model = model;
    this.host = host;
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
      { type: this.type, model: this.model, host: this.host },
    ]);

    const fullPrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n---\n\n${prompt}`
      : prompt;

    if (options?.responseFormat === 'json') {
      yield await this.runViaStructuredApi(fullPrompt, options);
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

  private async runViaStructuredApi(prompt: string, options?: RunOptions): Promise<string> {
    const baseUrl = new URL(this.host ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434');
    const url = new URL('/api/chat', baseUrl);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: options?.signal,
      body: JSON.stringify({
        model: this.model,
        messages: buildChatMessages(prompt),
        stream: false,
        format: ROUTER_OUTPUT_SCHEMA,
        options: {
          temperature: 0,
        },
      }),
    });

    if (!response.ok) {
      throw new AdapterError(
        `Ollama API request failed with status ${response.status}: ${await response.text()}`,
        this.type,
      );
    }

    const payload = (await response.json()) as { message?: { content?: string } };
    const content = payload.message?.content;
    if (typeof content !== 'string') {
      throw new AdapterError('Ollama API response did not include text output', this.type);
    }

    return content;
  }

  private buildEnv(): NodeJS.ProcessEnv {
    return this.host ? { ...process.env, OLLAMA_HOST: this.host } : process.env;
  }
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
              task: { type: 'string', minLength: 1 },
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

function buildChatMessages(prompt: string): Array<{ role: 'system' | 'user'; content: string }> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    {
      role: 'system',
      content:
        'Return only valid JSON that matches the provided schema. Do not include reasoning, markdown, or commentary.',
    },
  ];

  messages.push({ role: 'user', content: prompt });
  return messages;
}
