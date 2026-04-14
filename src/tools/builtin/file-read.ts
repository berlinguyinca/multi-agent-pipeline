import * as fs from 'fs/promises';
import * as path from 'path';
import type { Tool, ToolResult } from '../types.js';

interface FileReadToolConfig {
  workingDir: string;
  allowedPaths?: string[];
}

export function createFileReadTool(config: FileReadToolConfig): Tool {
  return {
    name: 'file-read',
    description: 'Read a file from the working directory',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'File path relative to working directory',
        required: true,
      },
    ],
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const filePath = params['path'] as string;
      const resolved = path.resolve(config.workingDir, filePath);

      if (!resolved.startsWith(path.resolve(config.workingDir))) {
        return {
          success: false,
          output: '',
          error: `Path "${filePath}" resolves outside working directory`,
        };
      }

      try {
        const content = await fs.readFile(resolved, 'utf-8');
        return { success: true, output: content };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: message };
      }
    },
  };
}
