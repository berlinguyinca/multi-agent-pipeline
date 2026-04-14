import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getGhCliToken, resolveGitHubToken } from '../../src/github/token.js';
import type { PipelineConfig } from '../../src/types/config.js';

// Mock child_process so we never exec a real binary
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';

const execFileMock = vi.mocked(execFile);

function mockExecFileSuccess(stdout: string) {
  execFileMock.mockImplementation(
    ((_cmd: string, _args: unknown, _opts: unknown, cb?: Function) => {
      if (cb) cb(null, { stdout, stderr: '' });
      // promisify branch: return value ignored when cb is provided
    }) as typeof execFile,
  );
}

function mockExecFileError(err: NodeJS.ErrnoException) {
  execFileMock.mockImplementation(
    ((_cmd: string, _args: unknown, _opts: unknown, cb?: Function) => {
      if (cb) cb(err);
    }) as typeof execFile,
  );
}

function makeConfig(token?: string): PipelineConfig {
  return {
    agents: {
      spec: { adapter: 'claude' },
      review: { adapter: 'claude' },
      qa: { adapter: 'claude' },
      execute: { adapter: 'claude' },
      docs: { adapter: 'claude' },
    },
    github: token !== undefined ? { token } : {},
    ollama: { host: 'http://localhost:11434' },
    quality: { maxSpecQaIterations: 3, maxCodeQaIterations: 3 },
    outputDir: './output',
    gitCheckpoints: false,
    headless: {
      totalTimeoutMs: 3_600_000,
      inactivityTimeoutMs: 600_000,
      pollIntervalMs: 10_000,
    },
    router: { adapter: 'ollama', model: 'gemma4', maxSteps: 10, timeoutMs: 30_000 },
    agentCreation: { adapter: 'ollama', model: 'gemma4' },
    agentOverrides: {},
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('getGhCliToken', () => {
  it('returns trimmed token on success', async () => {
    mockExecFileSuccess('ghp_abc123\n');
    const token = await getGhCliToken();
    expect(token).toBe('ghp_abc123');
  });

  it('returns undefined when gh is not installed (ENOENT)', async () => {
    const err = new Error('spawn gh ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockExecFileError(err);
    const token = await getGhCliToken();
    expect(token).toBeUndefined();
  });

  it('returns undefined when gh exits non-zero', async () => {
    const err = new Error('not logged in') as NodeJS.ErrnoException;
    (err as any).code = 1;
    mockExecFileError(err);
    const token = await getGhCliToken();
    expect(token).toBeUndefined();
  });

  it('returns undefined when gh outputs empty string', async () => {
    mockExecFileSuccess('  \n');
    const token = await getGhCliToken();
    expect(token).toBeUndefined();
  });
});

describe('resolveGitHubToken', () => {
  it('returns env var when GITHUB_TOKEN is set', async () => {
    const token = await resolveGitHubToken(makeConfig(), { GITHUB_TOKEN: 'env_token' });
    expect(token).toBe('env_token');
    // Should not call gh at all
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('skips empty env var and falls through', async () => {
    mockExecFileSuccess('ghp_from_cli\n');
    const token = await resolveGitHubToken(makeConfig(), { GITHUB_TOKEN: '  ' });
    expect(token).toBe('ghp_from_cli');
  });

  it('returns config token when env var is absent', async () => {
    const token = await resolveGitHubToken(makeConfig('config_token'), {});
    expect(token).toBe('config_token');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('falls through to gh CLI when env and config are absent', async () => {
    mockExecFileSuccess('ghp_cli_token\n');
    const token = await resolveGitHubToken(makeConfig(), {});
    expect(token).toBe('ghp_cli_token');
    expect(execFileMock).toHaveBeenCalled();
  });

  it('returns undefined when all sources are empty', async () => {
    const err = new Error('not found') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockExecFileError(err);
    const token = await resolveGitHubToken(makeConfig(), {});
    expect(token).toBeUndefined();
  });

  it('env var takes precedence over config token', async () => {
    const token = await resolveGitHubToken(
      makeConfig('config_token'),
      { GITHUB_TOKEN: 'env_token' },
    );
    expect(token).toBe('env_token');
  });

  it('config token takes precedence over gh CLI', async () => {
    mockExecFileSuccess('ghp_cli_token\n');
    const token = await resolveGitHubToken(makeConfig('config_token'), {});
    expect(token).toBe('config_token');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('handles undefined config gracefully', async () => {
    mockExecFileSuccess('ghp_fallback\n');
    const token = await resolveGitHubToken(undefined, {});
    expect(token).toBe('ghp_fallback');
  });
});
