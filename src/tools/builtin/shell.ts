import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolResult } from '../types.js';

const execAsync = promisify(exec);

interface ShellToolConfig {
  allowedCommands?: string[];
  workingDir?: string;
}

export function createShellTool(config: ShellToolConfig): Tool {
  return {
    name: 'shell',
    description: 'Execute shell commands in the working directory',
    parameters: [
      { name: 'command', type: 'string', description: 'The shell command to run', required: true },
    ],
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const command = params['command'] as string;

      if (config.allowedCommands && config.allowedCommands.length > 0) {
        const baseCommand = command.split(/\s+/)[0];
        if (!config.allowedCommands.includes(baseCommand)) {
          return {
            success: false,
            output: '',
            error: `Command "${baseCommand}" is not allowed. Allowed: ${config.allowedCommands.join(', ')}`,
          };
        }
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: config.workingDir,
          timeout: 30_000,
        });
        return { success: true, output: stdout + stderr };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, output: '', error: message };
      }
    },
  };
}
