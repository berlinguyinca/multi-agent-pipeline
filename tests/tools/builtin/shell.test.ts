import { describe, it, expect } from 'vitest';
import { createShellTool } from '../../../src/tools/builtin/shell.js';

describe('ShellTool', () => {
  it('has correct name and description', () => {
    const tool = createShellTool({});
    expect(tool.name).toBe('shell');
    expect(tool.description).toContain('Execute');
  });

  it('executes a simple command', async () => {
    const tool = createShellTool({});
    const result = await tool.execute({ command: 'echo hello' });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('hello');
  });

  it('restricts to allowed commands when configured', async () => {
    const tool = createShellTool({ allowedCommands: ['echo'] });
    const result = await tool.execute({ command: 'echo hello' });
    expect(result.success).toBe(true);

    const blocked = await tool.execute({ command: 'rm -rf /' });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('not allowed');
  });

  it('reports command failure', async () => {
    const tool = createShellTool({});
    const result = await tool.execute({ command: 'false' });
    expect(result.success).toBe(false);
  });

  it('uses configured working directory', async () => {
    const tool = createShellTool({ workingDir: '/tmp' });
    const result = await tool.execute({ command: 'pwd' });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toContain('/tmp');
  });
});
