import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createFileReadTool } from '../../../src/tools/builtin/file-read.js';

describe('FileReadTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-read-test-'));
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello world');
    await fs.mkdir(path.join(tmpDir, 'sub'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'sub', 'nested.txt'), 'nested content');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('has correct name', () => {
    const tool = createFileReadTool({ workingDir: tmpDir });
    expect(tool.name).toBe('file-read');
  });

  it('reads a file', async () => {
    const tool = createFileReadTool({ workingDir: tmpDir });
    const result = await tool.execute({ path: 'test.txt' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello world');
  });

  it('reads nested files', async () => {
    const tool = createFileReadTool({ workingDir: tmpDir });
    const result = await tool.execute({ path: 'sub/nested.txt' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('nested content');
  });

  it('rejects path traversal', async () => {
    const tool = createFileReadTool({ workingDir: tmpDir });
    const result = await tool.execute({ path: '../../../etc/passwd' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('outside');
  });

  it('returns error for missing file', async () => {
    const tool = createFileReadTool({ workingDir: tmpDir });
    const result = await tool.execute({ path: 'nonexistent.txt' });
    expect(result.success).toBe(false);
  });
});
