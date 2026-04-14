import { describe, expect, it, vi } from 'vitest';
import {
  buildGitHubIssuePrompt,
  buildGitHubReport,
  fetchGitHubIssueContext,
  getGitHubToken,
  parseGitHubIssueUrl,
  postGitHubIssueComment,
} from '../../src/github/issues.js';
import type { GitHubIssueContext } from '../../src/types/github.js';
import type { HeadlessResult } from '../../src/types/headless.js';

describe('parseGitHubIssueUrl', () => {
  it('parses github.com issue URLs', () => {
    expect(parseGitHubIssueUrl('https://github.com/openai/codex/issues/123')).toEqual({
      owner: 'openai',
      repo: 'codex',
      issueNumber: 123,
      url: 'https://github.com/openai/codex/issues/123',
    });
  });

  it('rejects non-issue URLs', () => {
    expect(() => parseGitHubIssueUrl('https://github.com/openai/codex/pull/123')).toThrow(
      'GitHub issue URL',
    );
  });
});

describe('getGitHubToken', () => {
  it('reads non-empty GITHUB_TOKEN', () => {
    expect(getGitHubToken({ GITHUB_TOKEN: '  ghp_test  ' })).toBe('ghp_test');
  });
});

describe('fetchGitHubIssueContext', () => {
  it('fetches issue and non-bot comments with GitHub headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/openai/codex/issues/123',
            title: 'Build pantry CLI',
            body: 'Issue body',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              body: 'Human comment',
              created_at: '2026-01-01T00:00:00Z',
              user: { login: 'alice', type: 'User' },
            },
            {
              body: 'Bot comment',
              created_at: '2026-01-01T00:01:00Z',
              user: { login: 'bot', type: 'Bot' },
            },
          ]),
          { status: 200 },
        ),
      );

    const context = await fetchGitHubIssueContext(
      parseGitHubIssueUrl('https://github.com/openai/codex/issues/123'),
      'token',
      fetchMock as typeof fetch,
    );

    expect(context.title).toBe('Build pantry CLI');
    expect(context.comments).toHaveLength(1);
    expect(context.comments[0]?.body).toBe('Human comment');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer token',
      Accept: 'application/vnd.github+json',
    });
  });
});

describe('buildGitHubIssuePrompt', () => {
  it('builds prompt from issue context and additional prompt', () => {
    const prompt = buildGitHubIssuePrompt(makeIssueContext(), 'Use TypeScript');

    expect(prompt).toContain('Build pantry CLI');
    expect(prompt).toContain('Issue body');
    expect(prompt).toContain('Comment body');
    expect(prompt).toContain('Use TypeScript');
  });
});

describe('postGitHubIssueComment', () => {
  it('posts a Markdown comment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ html_url: 'https://github.com/comment/1' }), {
        status: 201,
      }),
    );

    const result = await postGitHubIssueComment(
      parseGitHubIssueUrl('https://github.com/openai/codex/issues/123'),
      'token',
      'hello',
      fetchMock as typeof fetch,
    );

    expect(result.posted).toBe(true);
    expect(result.commentUrl).toBe('https://github.com/comment/1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/openai/codex/issues/123/comments',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ body: 'hello' });
  });
});

describe('buildGitHubReport', () => {
  it('includes result summary, spec, QA, and errors', () => {
    const report = buildGitHubReport(makeResult(), makeIssueContext());

    expect(report).toContain('MAP Pipeline Report');
    expect(report).toContain('Status: ❌ Failed');
    expect(report).toContain('Final Generated Spec');
    expect(report).toContain('Spec QA iteration 1');
    expect(report).toContain('Error: QA failed');
  });
});

function makeIssueContext(): GitHubIssueContext {
  return {
    ref: parseGitHubIssueUrl('https://github.com/openai/codex/issues/123'),
    title: 'Build pantry CLI',
    body: 'Issue body',
    url: 'https://github.com/openai/codex/issues/123',
    comments: [
      {
        author: 'alice',
        authorType: 'User',
        body: 'Comment body',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
}

function makeResult(): HeadlessResult {
  return {
    version: 1,
    success: false,
    spec: '# Spec',
    filesCreated: ['src/index.ts'],
    outputDir: './output/demo',
    testsTotal: 2,
    testsPassing: 1,
    testsFailing: 1,
    duration: 1000,
    qaAssessments: [
      {
        passed: false,
        target: 'spec',
        summary: 'Needs work',
        findings: ['Missing edge cases'],
        requiredChanges: ['Add edge cases'],
        rawOutput: 'QA_RESULT: fail',
        duration: 100,
      },
    ],
    error: 'QA failed',
  };
}
