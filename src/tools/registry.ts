import type { Tool } from './types.js';
import type { AgentDefinition, BuiltinToolConfig } from '../types/agent-definition.js';
import { createShellTool } from './builtin/shell.js';
import { createFileReadTool } from './builtin/file-read.js';
import { createWebSearchTool } from './builtin/web-search.js';
import { createKnowledgeSearchTool } from './builtin/knowledge-search.js';
import { createHttpApiTool } from './builtin/http-api.js';
import { createDbConnectionTool } from './builtin/db-connection.js';
import { createMcpProxyTool } from './mcp-proxy.js';

export function createToolRegistry(agent: AgentDefinition, workingDir: string): Tool[] {
  const tools: Tool[] = [
    createKnowledgeSearchTool({
      cwd: workingDir,
      maxResults: 5,
    }),
  ];
  for (const toolConfig of agent.tools) {
    if (toolConfig.type === 'mcp') {
      const tool = createMcpProxyTool(toolConfig.uri);
      if (!tools.some((existing) => existing.name === tool.name)) tools.push(tool);
      continue;
    }
    const tool = createBuiltinTool(toolConfig, workingDir);
    if (tool && !tools.some((existing) => existing.name === tool.name)) tools.push(tool);
  }
  return tools;
}

function createBuiltinTool(config: BuiltinToolConfig, workingDir: string): Tool | null {
  switch (config.name) {
    case 'shell':
      return createShellTool({
        allowedCommands: config.config?.['allowedCommands'] as string[] | undefined,
        workingDir,
      });
    case 'file-read':
      return createFileReadTool({
        workingDir,
        allowedPaths: config.config?.['allowedPaths'] as string[] | undefined,
      });
    case 'web-search':
      return createWebSearchTool({
        maxResults:
          typeof config.config?.['maxResults'] === 'number'
            ? (config.config['maxResults'] as number)
            : undefined,
      });
    case 'knowledge-search':
      return createKnowledgeSearchTool({
        cwd: workingDir,
        maxResults:
          typeof config.config?.['maxResults'] === 'number'
            ? (config.config['maxResults'] as number)
            : undefined,
      });
    case 'http-api':
      if (typeof config.config?.['baseUrl'] !== 'string') return null;
      return createHttpApiTool({
        baseUrl: config.config['baseUrl'] as string,
        headers: isStringRecord(config.config['headers'])
          ? config.config['headers']
          : undefined,
      });
    case 'db-connection':
      return createDbConnectionTool({
        dialect: typeof config.config?.['dialect'] === 'string'
          ? config.config['dialect'] as string
          : undefined,
        connectionString: typeof config.config?.['connectionString'] === 'string'
          ? config.config['connectionString'] as string
          : undefined,
        readOnly: typeof config.config?.['readOnly'] === 'boolean'
          ? config.config['readOnly'] as boolean
          : undefined,
      });
    default:
      return null;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
