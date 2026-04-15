import type { Tool, ToolResult } from '../types.js';
import { queryKnowledge } from '../../knowledge/index.js';

interface KnowledgeSearchToolConfig {
  cwd: string;
  maxResults?: number;
}

export function createKnowledgeSearchTool(config: KnowledgeSearchToolConfig): Tool {
  return {
    name: 'knowledge-search',
    description: 'Query the shared 2nd brain and return compact indexed snippets with freshness metadata',
    parameters: [
      { name: 'query', type: 'string', description: 'Knowledge query', required: true },
    ],
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const query = String(params['query'] ?? '').trim();
      if (!query) {
        return { success: false, output: '', error: 'Missing query' };
      }

      try {
        const results = await queryKnowledge({
          cwd: config.cwd,
          query,
          limit: config.maxResults ?? 5,
        });
        return {
          success: true,
          output:
            results.length > 0
              ? results
                  .map(
                    (result, index) =>
                      `${index + 1}. ${result.title} [${result.scope} | ${result.category} | ${result.state}]\nPath: ${result.path}\nSnippet: ${result.content}`,
                  )
                  .join('\n\n')
              : 'No matching knowledge entries found.',
        };
      } catch (err: unknown) {
        return {
          success: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
