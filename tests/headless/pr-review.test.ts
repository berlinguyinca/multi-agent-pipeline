import { describe, expect, it, vi } from 'vitest';
import { runPRReview } from '../../src/headless/pr-review.js';
import type { PipelineConfig } from '../../src/types/config.js';
import type { AgentAdapter } from '../../src/types/adapter.js';

// Mock gh CLI so resolveGitHubToken doesn't try to exec a real binary
vi.mock('../../src/github/token.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/github/token.js')>();
  return {
    ...actual,
    resolveGitHubToken: async (
      config?: unknown,
      env: NodeJS.ProcessEnv = process.env,
    ) => {
      const token = (env['GITHUB_TOKEN'] as string | undefined)?.trim();
      if (token && token !== '') return token;
      const cfg = config as { github?: { token?: string } } | undefined;
      const cfgToken = cfg?.github?.token;
      if (cfgToken && cfgToken.trim() !== '') return cfgToken.trim();
      return undefined;
    },
  };
});

function makeConfig(): PipelineConfig {
  return {
    agents: {
      spec: { adapter: 'claude' },
      review: { adapter: 'claude' },
      qa: { adapter: 'claude' },
      execute: { adapter: 'claude' },
      docs: { adapter: 'claude' },
    },
    github: {},
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

describe('runPRReview', () => {
  it('fails without GITHUB_TOKEN', async () => {
    const result = await runPRReview(
      { prUrl: 'https://github.com/owner/repo/pull/1' },
      {
        loadConfigFn: vi.fn().mockResolvedValue(makeConfig()),
        createAdapterFn: vi.fn(),
        env: {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('GITHUB_TOKEN');
  });

  it('fails with invalid PR URL', async () => {
    const result = await runPRReview(
      { prUrl: 'not-a-url' },
      {
        loadConfigFn: vi.fn().mockResolvedValue(makeConfig()),
        createAdapterFn: vi.fn(),
        env: { GITHUB_TOKEN: 'ghp_test' },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('valid URL');
  });

  it('runs full review pipeline and posts comment', async () => {
    const reviewOutput = '### Summary\nGood PR.\n\n### Verdict\nAPPROVE';
    const adapter = makeFakeAdapter(reviewOutput);

    const fetchMock = vi
      .fn()
      // PR details
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo/pull/1',
            title: 'Fix bug',
            body: 'Fixes issue #5',
            base: { ref: 'main' },
            head: { ref: 'fix/bug' },
          }),
          { status: 200 },
        ),
      )
      // PR files
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              filename: 'src/app.ts',
              status: 'modified',
              additions: 3,
              deletions: 1,
              patch: '@@ -1 +1,3 @@\n+fix',
            },
          ]),
          { status: 200 },
        ),
      )
      // PR comments
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      )
      // Post review comment
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo/pull/1#issuecomment-99',
          }),
          { status: 201 },
        ),
      );

    const result = await runPRReview(
      { prUrl: 'https://github.com/owner/repo/pull/1' },
      {
        loadConfigFn: vi.fn().mockResolvedValue(makeConfig()),
        createAdapterFn: vi.fn().mockReturnValue(adapter),
        fetchFn: fetchMock as typeof fetch,
        env: { GITHUB_TOKEN: 'ghp_test' },
      },
    );

    expect(result.success).toBe(true);
    expect(result.review).toContain('Good PR.');
    expect(result.githubReport?.posted).toBe(true);
    expect(result.githubReport?.commentUrl).toContain('issuecomment-99');
  });

  it('applies personality directive when provided', async () => {
    const adapter = makeFakeAdapter('Review output');
    let capturedPrompt = '';

    const runSpy = vi.fn(async function* (prompt: string) {
      capturedPrompt = prompt;
      yield 'Review output';
    });
    const adapterWithSpy = { ...adapter, run: runSpy };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            title: 'PR', body: '', base: { ref: 'main' }, head: { ref: 'feat' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ html_url: 'https://example.com' }), { status: 201 }),
      );

    await runPRReview(
      {
        prUrl: 'https://github.com/owner/repo/pull/1',
        personality: 'Be sarcastic',
      },
      {
        loadConfigFn: vi.fn().mockResolvedValue(makeConfig()),
        createAdapterFn: vi.fn().mockReturnValue(adapterWithSpy),
        fetchFn: fetchMock as typeof fetch,
        env: { GITHUB_TOKEN: 'ghp_test' },
      },
    );

    expect(capturedPrompt).toContain('[PERSONALITY DIRECTIVE]');
    expect(capturedPrompt).toContain('Be sarcastic');
  });
});
