import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolResult } from '../types.js';

const execFileAsync = promisify(execFile);

interface DbConnectionToolConfig {
  dialect?: string;
  connectionString?: string;
  readOnly?: boolean;
}

export function createDbConnectionTool(config: DbConnectionToolConfig): Tool {
  return {
    name: 'db-connection',
    description: 'Execute read-only SQL against a configured database connection',
    parameters: [
      { name: 'query', type: 'string', description: 'SQL query to execute', required: true },
    ],
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const query = typeof params['query'] === 'string' ? params['query'].trim() : '';
      if (!query) {
        return { success: false, output: '', error: 'query is required' };
      }

      const readOnly = config.readOnly !== false;
      if (readOnly && !isReadOnlyQuery(query)) {
        return {
          success: false,
          output: '',
          error: 'db-connection is read-only by default; only SELECT, WITH, EXPLAIN, and SHOW are allowed',
        };
      }

      if ((config.dialect ?? 'postgres') !== 'postgres') {
        return { success: false, output: '', error: `Unsupported db dialect: ${config.dialect}` };
      }
      if (!config.connectionString) {
        return { success: false, output: '', error: 'db-connection requires config.connectionString' };
      }

      try {
        const { stdout, stderr } = await execFileAsync('psql', [
          config.connectionString,
          '--csv',
          '--no-align',
          '--command',
          query,
        ], { timeout: 30_000 });
        return { success: true, output: stdout + stderr };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: message };
      }
    },
  };
}

function isReadOnlyQuery(query: string): boolean {
  const normalized = query.replace(/^\s*--.*$/gm, '').trim().toLowerCase();
  return /^(select|with|explain|show)\b/.test(normalized);
}
