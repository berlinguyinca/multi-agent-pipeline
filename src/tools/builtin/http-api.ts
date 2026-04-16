import type { Tool, ToolResult } from '../types.js';

interface HttpApiToolConfig {
  baseUrl: string;
  headers?: Record<string, string>;
}

export function createHttpApiTool(config: HttpApiToolConfig): Tool {
  return {
    name: 'http-api',
    description: 'Call a configured HTTP API endpoint',
    parameters: [
      { name: 'path', type: 'string', description: 'Path relative to the configured baseUrl', required: true },
      { name: 'method', type: 'string', description: 'HTTP method, defaults to GET', required: false },
      { name: 'body', type: 'string', description: 'Optional JSON request body as a string', required: false },
    ],
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const path = typeof params['path'] === 'string' ? params['path'] : '';
      if (!path) {
        return { success: false, output: '', error: 'path is required' };
      }

      try {
        const url = new URL(path, config.baseUrl);
        const method = typeof params['method'] === 'string' ? params['method'].toUpperCase() : 'GET';
        const body = typeof params['body'] === 'string' && method !== 'GET' ? params['body'] : undefined;
        const response = await fetch(url, {
          method,
          headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(config.headers ?? {}),
          },
          body,
        });
        const text = await response.text();
        return {
          success: response.ok,
          output: text,
          ...(response.ok ? {} : { error: `HTTP ${response.status} ${response.statusText}` }),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: message };
      }
    },
  };
}
