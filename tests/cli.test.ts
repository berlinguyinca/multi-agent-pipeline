import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('CLI', () => {
  it('shows help with --help flag', async () => {
    const { stdout } = await execFileAsync('npx', ['tsx', 'src/cli.ts', '--help']);
    expect(stdout).toContain('MAP - Multi-Agent Pipeline');
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--resume');
  });

  it('shows version with --version flag', async () => {
    const { stdout } = await execFileAsync('npx', ['tsx', 'src/cli.ts', '--version']);
    expect(stdout.trim()).toBe('0.1.0');
  });
});
