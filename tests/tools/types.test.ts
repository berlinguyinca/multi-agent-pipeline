import { describe, it, expect } from 'vitest';
import type { Tool, ToolResult, ToolParameter } from '../../src/tools/types.js';
import { formatToolCatalog } from '../../src/tools/types.js';

describe('Tool types', () => {
  const shellTool: Tool = {
    name: 'shell',
    description: 'Execute shell commands',
    parameters: [
      { name: 'command', type: 'string', description: 'The command to run', required: true },
    ],
    execute: async () => ({ success: true, output: '' }),
  };

  const fileReadTool: Tool = {
    name: 'file-read',
    description: 'Read a file from the working directory',
    parameters: [
      { name: 'path', type: 'string', description: 'File path', required: true },
    ],
    execute: async () => ({ success: true, output: '' }),
  };

  describe('formatToolCatalog', () => {
    it('formats a single tool', () => {
      const catalog = formatToolCatalog([shellTool]);
      expect(catalog).toContain('shell');
      expect(catalog).toContain('Execute shell commands');
      expect(catalog).toContain('command');
      expect(catalog).toContain('string');
    });

    it('formats multiple tools', () => {
      const catalog = formatToolCatalog([shellTool, fileReadTool]);
      expect(catalog).toContain('shell');
      expect(catalog).toContain('file-read');
    });

    it('returns empty string for no tools', () => {
      expect(formatToolCatalog([])).toBe('');
    });

    it('marks required parameters', () => {
      const catalog = formatToolCatalog([shellTool]);
      expect(catalog).toContain('required');
    });
  });
});
