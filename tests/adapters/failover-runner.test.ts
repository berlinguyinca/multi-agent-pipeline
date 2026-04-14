import { describe, expect, it, vi } from 'vitest';
import { runWithFailover, buildAdapterChain } from '../../src/adapters/failover-runner.js';
import { AdapterError } from '../../src/adapters/base-adapter.js';
import { AllAdaptersExhaustedError } from '../../src/utils/error.js';
import type { AdapterConfig, AgentAdapter } from '../../src/types/adapter.js';
import type { AgentAssignment } from '../../src/types/config.js';

function makeFakeAdapter(output: string): AgentAdapter {
  return {
    type: 'claude',
    model: undefined,
    detect: vi.fn(),
    run: async function* () {
      yield output;
    },
    cancel: vi.fn(),
  };
}

function makeQuotaError(adapterType: 'claude' | 'codex' = 'claude'): AdapterError {
  return new AdapterError(
    `${adapterType} exited with code 1`,
    adapterType,
    1,
    'quota exceeded for this billing period',
  );
}

function makeNonQuotaError(): AdapterError {
  return new AdapterError('claude exited with code 1: syntax error', 'claude', 1, 'syntax error');
}

describe('runWithFailover', () => {
  it('returns result from primary adapter on success', async () => {
    const configs: AdapterConfig[] = [
      { type: 'claude' },
      { type: 'codex' },
    ];
    const adapter = makeFakeAdapter('result');
    const factory = vi.fn().mockReturnValue(adapter);
    const execute = vi.fn().mockResolvedValue('output');

    const result = await runWithFailover(configs, factory, execute);

    expect(result).toBe('output');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith({ type: 'claude' });
  });

  it('fails over to next adapter on quota exhaustion', async () => {
    const configs: AdapterConfig[] = [
      { type: 'claude' },
      { type: 'codex' },
    ];
    const adapter1 = makeFakeAdapter('');
    const adapter2 = makeFakeAdapter('');
    const factory = vi.fn()
      .mockReturnValueOnce(adapter1)
      .mockReturnValueOnce(adapter2);
    const execute = vi.fn()
      .mockRejectedValueOnce(makeQuotaError())
      .mockResolvedValueOnce('fallback-output');

    const result = await runWithFailover(configs, factory, execute);

    expect(result).toBe('fallback-output');
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenNthCalledWith(1, { type: 'claude' });
    expect(factory).toHaveBeenNthCalledWith(2, { type: 'codex' });
  });

  it('tries all adapters in chain before exhausting', async () => {
    const configs: AdapterConfig[] = [
      { type: 'claude' },
      { type: 'codex' },
      { type: 'ollama', model: 'gemma4' },
    ];
    const factory = vi.fn().mockReturnValue(makeFakeAdapter(''));
    const execute = vi.fn()
      .mockRejectedValueOnce(makeQuotaError('claude'))
      .mockRejectedValueOnce(makeQuotaError('codex'))
      .mockResolvedValueOnce('third-output');

    const result = await runWithFailover(configs, factory, execute);

    expect(result).toBe('third-output');
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('throws AllAdaptersExhaustedError when all adapters hit quota', async () => {
    const configs: AdapterConfig[] = [
      { type: 'claude' },
      { type: 'codex' },
    ];
    const factory = vi.fn().mockReturnValue(makeFakeAdapter(''));
    const execute = vi.fn()
      .mockRejectedValueOnce(makeQuotaError('claude'))
      .mockRejectedValueOnce(makeQuotaError('codex'));

    await expect(runWithFailover(configs, factory, execute))
      .rejects.toThrow(AdapterError);
    // Last adapter's error is thrown directly, not wrapped
  });

  it('propagates non-quota errors immediately without failover', async () => {
    const configs: AdapterConfig[] = [
      { type: 'claude' },
      { type: 'codex' },
    ];
    const factory = vi.fn().mockReturnValue(makeFakeAdapter(''));
    const execute = vi.fn().mockRejectedValue(makeNonQuotaError());

    await expect(runWithFailover(configs, factory, execute))
      .rejects.toThrow('syntax error');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('throws if configs array is empty', async () => {
    await expect(
      runWithFailover([], vi.fn(), vi.fn()),
    ).rejects.toThrow('at least one adapter config');
  });

  it('works with single adapter (no fallbacks)', async () => {
    const configs: AdapterConfig[] = [{ type: 'claude' }];
    const factory = vi.fn().mockReturnValue(makeFakeAdapter(''));
    const execute = vi.fn().mockResolvedValue('single');

    const result = await runWithFailover(configs, factory, execute);

    expect(result).toBe('single');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('throws quota error from single adapter (no failover possible)', async () => {
    const configs: AdapterConfig[] = [{ type: 'claude' }];
    const factory = vi.fn().mockReturnValue(makeFakeAdapter(''));
    const execute = vi.fn().mockRejectedValue(makeQuotaError());

    await expect(runWithFailover(configs, factory, execute))
      .rejects.toThrow(AdapterError);
  });

  it('logs failover to stderr', async () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const configs: AdapterConfig[] = [
      { type: 'claude' },
      { type: 'codex' },
    ];
    const factory = vi.fn().mockReturnValue(makeFakeAdapter(''));
    const execute = vi.fn()
      .mockRejectedValueOnce(makeQuotaError())
      .mockResolvedValueOnce('ok');

    await runWithFailover(configs, factory, execute);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('claude quota exhausted, failing over to codex'),
    );
    stderrSpy.mockRestore();
  });
});

describe('buildAdapterChain', () => {
  it('returns single-element chain when no fallbacks', () => {
    const assignment: AgentAssignment = { adapter: 'claude' };
    const chain = buildAdapterChain(assignment);

    expect(chain).toEqual([{ type: 'claude' }]);
  });

  it('returns primary + fallbacks in order', () => {
    const assignment: AgentAssignment = {
      adapter: 'claude',
      fallbacks: [
        { adapter: 'codex' },
        { adapter: 'ollama', model: 'gemma4' },
      ],
    };
    const chain = buildAdapterChain(assignment, 'http://localhost:11434');

    expect(chain).toEqual([
      { type: 'claude' },
      { type: 'codex' },
      { type: 'ollama', model: 'gemma4', host: 'http://localhost:11434' },
    ]);
  });

  it('passes ollama host to primary and fallbacks', () => {
    const assignment: AgentAssignment = {
      adapter: 'ollama',
      model: 'llama3',
      fallbacks: [{ adapter: 'ollama', model: 'gemma4' }],
    };
    const chain = buildAdapterChain(assignment, 'http://custom:11434');

    expect(chain[0]).toEqual({ type: 'ollama', model: 'llama3', host: 'http://custom:11434' });
    expect(chain[1]).toEqual({ type: 'ollama', model: 'gemma4', host: 'http://custom:11434' });
  });
});
