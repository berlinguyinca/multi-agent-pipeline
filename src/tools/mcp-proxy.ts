import type { Tool, ToolResult } from './types.js';

export function createMcpProxyTool(uri: string): Tool {
  const endpoint = mcpUriToHttpEndpoint(uri);
  return {
    name: mcpToolName(uri),
    description: `Proxy a JSON-RPC tools/call request to MCP server ${uri}`,
    parameters: [
      { name: 'tool', type: 'string', description: 'Remote MCP tool name', required: true },
      { name: 'params', type: 'string', description: 'Remote MCP tool params as JSON', required: false },
    ],
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const toolName = typeof params['tool'] === 'string' ? params['tool'] : '';
      if (!toolName) {
        return { success: false, output: '', error: 'tool is required' };
      }

      let parsedParams: unknown = {};
      if (typeof params['params'] === 'string' && params['params'].trim() !== '') {
        try {
          parsedParams = JSON.parse(params['params']);
        } catch {
          return { success: false, output: '', error: 'params must be valid JSON when provided' };
        }
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: parsedParams,
            },
          }),
        });
        const text = await response.text();
        return {
          success: response.ok,
          output: text,
          ...(response.ok ? {} : { error: `MCP HTTP ${response.status} ${response.statusText}` }),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: message };
      }
    },
  };
}

function mcpUriToHttpEndpoint(uri: string): string {
  const parsed = new URL(uri);
  parsed.protocol = parsed.protocol === 'mcps:' ? 'https:' : 'http:';
  return parsed.toString();
}

function mcpToolName(uri: string): string {
  return `mcp-${uri
    .replace(/^mcps?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()}`;
}
