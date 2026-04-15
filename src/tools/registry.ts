import type { Tool } from './types.js';
import type { AgentDefinition, BuiltinToolConfig } from '../types/agent-definition.js';
import { createShellTool } from './builtin/shell.js';
import { createFileReadTool } from './builtin/file-read.js';
import { createWebSearchTool } from './builtin/web-search.js';
import { createKnowledgeSearchTool } from './builtin/knowledge-search.js';

export function createToolRegistry(agent: AgentDefinition, workingDir: string): Tool[] {
  const tools: Tool[] = [
    createKnowledgeSearchTool({
      cwd: workingDir,
      maxResults: 5,
    }),
  ];
  for (const toolConfig of agent.tools) {
    if (toolConfig.type === 'mcp') continue;
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
    default:
      return null;
  }
}
