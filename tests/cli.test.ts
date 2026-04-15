import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const NO_UPDATE_ENV = { ...process.env, MAP_NO_UPDATE: '1' };

describe('CLI', () => {
  it('shows help with --help flag', async () => {
    const { stdout } = await execFileAsync('npx', ['tsx', 'src/cli.ts', '--help'], {
      env: NO_UPDATE_ENV,
    });
    expect(stdout).toContain('MAP - Multi-Agent Pipeline');
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--resume');
    expect(stdout).toContain('Runtime updates:');
    expect(stdout).toContain('MAP_NO_UPDATE=1');
  });

  it('shows version with --version flag', async () => {
    const { stdout } = await execFileAsync('npx', ['tsx', 'src/cli.ts', '--version'], {
      env: NO_UPDATE_ENV,
    });
    expect(stdout.trim()).toBe('0.1.0');
  });
});
