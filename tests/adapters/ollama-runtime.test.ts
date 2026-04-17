import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
  spawn: mocks.spawn,
}));

const { ensureOllamaReadyForConfigs, resetOllamaRuntimeStateForTests } = await import(
  '../../src/adapters/ollama-runtime.js'
);

interface ExecResult {
  stdout?: string;
  stderr?: string;
}

function execSuccess(stdout = ''): ExecResult {
  return { stdout };
}

function execFailure(message: string): Error {
  return new Error(message);
}

function mockExecSequence(...results: Array<ExecResult | Error>): void {
  const queue = [...results];
  mocks.execFile.mockImplementation((_cmd, _args, optionsOrCallback, maybeCallback) => {
    const callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    const result = queue.shift();

    if (!callback) {
      throw new Error('Missing execFile callback');
    }

    if (result instanceof Error) {
      callback(result);
    } else {
      callback(null, {
        stdout: result?.stdout ?? '',
        stderr: result?.stderr ?? '',
      });
    }

    return {};
  });
}

describe('ollama runtime guard', () => {
  beforeEach(() => {
    resetOllamaRuntimeStateForTests();
    mocks.execFile.mockReset();
    mocks.spawn.mockReset();
    mocks.spawn.mockReturnValue({ unref: vi.fn() });
  });

  it('skips startup and pull when no enabled config uses ollama', async () => {
    await ensureOllamaReadyForConfigs([
      { type: 'claude' },
      { type: 'ollama', model: 'gemma4:26b', enabled: false },
    ]);

    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('does not start ollama serve when the server is already available', async () => {
    mockExecSequence(
      execSuccess('ollama version 1.0.0'),
      execSuccess('NAME ID SIZE MODIFIED\ngemma4:26b abc 1 GB now\n'),
      execSuccess('success'),
    );

    await ensureOllamaReadyForConfigs([
      { type: 'ollama', model: 'gemma4:26b', host: 'http://127.0.0.1:11434' },
    ]);

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.execFile).toHaveBeenCalledWith(
      'ollama',
      ['pull', 'gemma4:26b'],
      { env: expect.objectContaining({ OLLAMA_HOST: 'http://127.0.0.1:11434' }) },
      expect.any(Function),
    );
  });

  it('starts ollama serve when the server probe fails', async () => {
    mockExecSequence(
      execSuccess('ollama version 1.0.0'),
      execFailure('connection refused'),
      execSuccess('NAME ID SIZE MODIFIED\n'),
      execSuccess('success'),
    );

    await ensureOllamaReadyForConfigs([
      { type: 'ollama', model: 'gemma4:26b' },
    ]);

    expect(mocks.spawn).toHaveBeenCalledWith('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      env: expect.objectContaining({
        OLLAMA_CONTEXT_LENGTH: '100000',
        OLLAMA_NUM_PARALLEL: '2',
        OLLAMA_MAX_LOADED_MODELS: '2',
      }),
    });
  });

  it('uses configured Ollama server env when starting and pulling models', async () => {
    mockExecSequence(
      execSuccess('ollama version 1.0.0'),
      execFailure('connection refused'),
      execSuccess('NAME ID SIZE MODIFIED\n'),
      execSuccess('success'),
    );

    await ensureOllamaReadyForConfigs([
      {
        type: 'ollama',
        model: 'qwen3:latest',
        host: 'http://127.0.0.1:11435',
        contextLength: 64000,
        numParallel: 4,
        maxLoadedModels: 3,
      },
    ]);

    const expectedEnv = expect.objectContaining({
      OLLAMA_HOST: 'http://127.0.0.1:11435',
      OLLAMA_CONTEXT_LENGTH: '64000',
      OLLAMA_NUM_PARALLEL: '4',
      OLLAMA_MAX_LOADED_MODELS: '3',
    });

    expect(mocks.spawn).toHaveBeenCalledWith('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      env: expectedEnv,
    });
    expect(mocks.execFile).toHaveBeenCalledWith(
      'ollama',
      ['pull', 'qwen3:latest'],
      { env: expectedEnv },
      expect.any(Function),
    );
  });

  it('pulls missing models and refreshes existing tags once per process run', async () => {
    mockExecSequence(
      execSuccess('ollama version 1.0.0'),
      execSuccess('NAME ID SIZE MODIFIED\n'),
      execSuccess('success'),
    );

    await ensureOllamaReadyForConfigs([
      { type: 'ollama', model: 'gemma4:26b' },
      { type: 'ollama', model: 'gemma4:26b' },
    ]);
    await ensureOllamaReadyForConfigs([
      { type: 'ollama', model: 'gemma4:26b' },
    ]);

    const pullCalls = mocks.execFile.mock.calls.filter(
      ([cmd, args]) => cmd === 'ollama' && Array.isArray(args) && args[0] === 'pull',
    );

    expect(pullCalls).toHaveLength(1);
    expect(pullCalls[0][1]).toEqual(['pull', 'gemma4:26b']);
  });
});
