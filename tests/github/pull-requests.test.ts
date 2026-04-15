import { describe, expect, it, vi } from 'vitest';
import {
  buildPRReviewPrompt,
  fetchGitHubPRContext,
  mergeGitHubPR,
  parseGitHubPRUrl,
  postGitHubPRReview,
} from '../../src/github/pull-requests.js';
import type { GitHubPRContext } from '../../src/types/github.js';

describe('parseGitHubPRUrl', () => {
  it('parses github.com PR URLs', () => {
    expect(parseGitHubPRUrl('https://github.com/owner/repo/pull/42')).toEqual({
      owner: 'owner',
      repo: 'repo',
      pullNumber: 42,
      url: 'https://github.com/owner/repo/pull/42',
    });
  });

  it('rejects issue URLs', () => {
    expect(() => parseGitHubPRUrl('https://github.com/owner/repo/issues/42')).toThrow(
      'GitHub PR URL must look like',
    );
  });

  it('rejects non-github URLs', () => {
    expect(() => parseGitHubPRUrl('https://gitlab.com/owner/repo/pull/42')).toThrow(
      'GitHub PR URL must use https://github.com',
    );
  });

  it('rejects invalid PR numbers', () => {
    expect(() => parseGitHubPRUrl('https://github.com/owner/repo/pull/abc')).toThrow(
      'GitHub PR number must be a positive integer',
    );
  });

  it('rejects URLs with extra path segments', () => {
    expect(() =>
      parseGitHubPRUrl('https://github.com/owner/repo/pull/42/files'),
    ).toThrow('GitHub PR URL must look like');
  });

  it('rejects non-URL strings', () => {
    expect(() => parseGitHubPRUrl('not-a-url')).toThrow('GitHub PR URL must be a valid URL');
  });

  it('rejects zero as PR number', () => {
    expect(() => parseGitHubPRUrl('https://github.com/owner/repo/pull/0')).toThrow(
      'GitHub PR number must be a positive integer',
    );
  });
});

describe('fetchGitHubPRContext', () => {
  it('fetches PR details, files, and non-bot comments', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo/pull/42',
            title: 'Add feature X',
            body: 'This PR adds feature X.',
            base: { ref: 'main' },
            head: { ref: 'feat/x' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              filename: 'src/index.ts',
              status: 'modified',
              additions: 10,
              deletions: 2,
              patch: '@@ -1,5 +1,13 @@\n+added line',
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              body: 'Looks good',
              created_at: '2026-04-01T10:00:00Z',
              user: { login: 'reviewer', type: 'User' },
            },
            {
              body: 'Auto-check passed',
              created_at: '2026-04-01T10:01:00Z',
              user: { login: 'ci-bot', type: 'Bot' },
            },
          ]),
          { status: 200 },
        ),
      );

    const ref = parseGitHubPRUrl('https://github.com/owner/repo/pull/42');
    const context = await fetchGitHubPRContext(ref, 'token', fetchMock as typeof fetch);

    expect(context.title).toBe('Add feature X');
    expect(context.body).toBe('This PR adds feature X.');
    expect(context.baseBranch).toBe('main');
    expect(context.headBranch).toBe('feat/x');
    expect(context.files).toHaveLength(1);
    expect(context.files[0]?.filename).toBe('src/index.ts');
    expect(context.files[0]?.patch).toContain('+added line');
    expect(context.comments).toHaveLength(1);
    expect(context.comments[0]?.author).toBe('reviewer');

    // Verifies correct API URLs
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/owner/repo/pulls/42',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.github.com/repos/owner/repo/pulls/42/files?per_page=100',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.github.com/repos/owner/repo/pulls/42/comments?per_page=100',
    );

    // Verifies auth headers
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer token',
      Accept: 'application/vnd.github+json',
    });
  });
});

describe('buildPRReviewPrompt', () => {
  it('includes PR metadata, files, diff, and comments', () => {
    const context = makePRContext();
    const prompt = buildPRReviewPrompt(context);

    expect(prompt).toContain('Add feature X');
    expect(prompt).toContain('feat/x → main');
    expect(prompt).toContain('src/index.ts');
    expect(prompt).toContain('+added line');
    expect(prompt).toContain('Looks good');
    expect(prompt).toContain('This PR adds feature X.');
  });

  it('handles PRs with no comments', () => {
    const context = makePRContext();
    context.comments = [];
    const prompt = buildPRReviewPrompt(context);

    expect(prompt).toContain('(no review comments)');
  });

  it('handles files with no patch', () => {
    const context = makePRContext();
    context.files = [
      { filename: 'binary.png', status: 'added', additions: 0, deletions: 0 },
    ];
    const prompt = buildPRReviewPrompt(context);

    expect(prompt).toContain('binary.png');
    expect(prompt).not.toContain('```diff');
  });
});

describe('postGitHubPRReview', () => {
  it('posts a review comment on the PR', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ html_url: 'https://github.com/owner/repo/pull/42#issuecomment-1' }),
        { status: 201 },
      ),
    );

    const ref = parseGitHubPRUrl('https://github.com/owner/repo/pull/42');
    const result = await postGitHubPRReview(ref, 'token', 'Great PR!', fetchMock as typeof fetch);

    expect(result.posted).toBe(true);
    expect(result.commentUrl).toBe('https://github.com/owner/repo/pull/42#issuecomment-1');
    // Posts to issue comments endpoint (PRs are issues in GitHub API)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/owner/repo/issues/42/comments',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      body: 'Great PR!',
    });
  });

  it('returns error on API failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Forbidden', { status: 403 }),
    );

    const ref = parseGitHubPRUrl('https://github.com/owner/repo/pull/42');
    const result = await postGitHubPRReview(ref, 'token', 'Review', fetchMock as typeof fetch);

    expect(result.posted).toBe(false);
    expect(result.error).toContain('403');
  });
});

describe('mergeGitHubPR', () => {
  it('merges the pull request via the GitHub API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          merged: true,
          sha: 'deadbeef',
          html_url: 'https://github.com/owner/repo/pull/42',
        }),
        { status: 200 },
      ),
    );

    const ref = parseGitHubPRUrl('https://github.com/owner/repo/pull/42');
    const result = await mergeGitHubPR(ref, 'token', fetchMock as typeof fetch);

    expect(result.merged).toBe(true);
    expect(result.posted).toBe(false);
    expect(result.mergeUrl).toBe('https://github.com/owner/repo/pull/42');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/owner/repo/pulls/42/merge',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
  });

  it('returns error on merge failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Conflict', { status: 405 }),
    );

    const ref = parseGitHubPRUrl('https://github.com/owner/repo/pull/42');
    const result = await mergeGitHubPR(ref, 'token', fetchMock as typeof fetch);

    expect(result.merged).toBeUndefined();
    expect(result.error).toContain('405');
  });
});

function makePRContext(): GitHubPRContext {
  return {
    ref: parseGitHubPRUrl('https://github.com/owner/repo/pull/42'),
    title: 'Add feature X',
    body: 'This PR adds feature X.',
    url: 'https://github.com/owner/repo/pull/42',
    baseBranch: 'main',
    headBranch: 'feat/x',
    files: [
      {
        filename: 'src/index.ts',
        status: 'modified',
        additions: 10,
        deletions: 2,
        patch: '@@ -1,5 +1,13 @@\n+added line',
      },
    ],
    comments: [
      {
        author: 'reviewer',
        authorType: 'User',
        body: 'Looks good',
        createdAt: '2026-04-01T10:00:00Z',
      },
    ],
  };
}
