import { describe, expect, it, vi } from 'vitest';
import {
  buildYouTrackIssuePrompt,
  fetchYouTrackIssueContext,
  parseYouTrackIssueRef,
  resolveYouTrackIssueRef,
} from '../../src/youtrack/issues.js';

describe('parseYouTrackIssueRef', () => {
  it('parses full YouTrack issue URLs with nested base path', () => {
    expect(parseYouTrackIssueRef('https://wcmc.myjetbrains.com/youtrack/issue/MAP-123/Title')).toEqual({
      id: 'MAP-123',
      baseUrl: 'https://wcmc.myjetbrains.com/youtrack',
      url: 'https://wcmc.myjetbrains.com/youtrack/issue/MAP-123',
    });
  });

  it('parses root-level YouTrack issue URLs', () => {
    expect(parseYouTrackIssueRef('https://youtrack.example.test/issue/MAP-123')).toEqual({
      id: 'MAP-123',
      baseUrl: 'https://youtrack.example.test',
      url: 'https://youtrack.example.test/issue/MAP-123',
    });
  });

  it('rejects non-issue URLs', () => {
    expect(() => parseYouTrackIssueRef('https://youtrack.example.test/articles/MAP-123')).toThrow('YouTrack issue URL');
  });
});

describe('resolveYouTrackIssueRef', () => {
  it('resolves bare issue ids through the configured base URL', () => {
    expect(resolveYouTrackIssueRef('MAP-123', 'https://wcmc.myjetbrains.com/youtrack')).toEqual({
      id: 'MAP-123',
      baseUrl: 'https://wcmc.myjetbrains.com/youtrack',
      url: 'https://wcmc.myjetbrains.com/youtrack/issue/MAP-123',
    });
  });

  it('requires a base URL for bare issue ids', () => {
    expect(() => resolveYouTrackIssueRef('MAP-123')).toThrow('YouTrack base URL');
  });
});

describe('fetchYouTrackIssueContext', () => {
  it('fetches issue summary, description, and comments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        idReadable: 'MAP-123',
        summary: 'Build YouTrack ingestion',
        description: 'Issue description',
        comments: [
          {
            text: 'Human comment',
            created: 1776787200000,
            author: { login: 'alice', fullName: 'Alice Example' },
          },
        ],
      }), { status: 200 }),
    );

    const context = await fetchYouTrackIssueContext(
      resolveYouTrackIssueRef('MAP-123', 'https://wcmc.myjetbrains.com/youtrack'),
      'yt-token',
      fetchMock as typeof fetch,
    );

    expect(context.title).toBe('Build YouTrack ingestion');
    expect(context.body).toBe('Issue description');
    expect(context.comments[0]?.body).toBe('Human comment');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/youtrack/api/issues/MAP-123');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer yt-token',
      Accept: 'application/json',
    });
  });
});

describe('buildYouTrackIssuePrompt', () => {
  it('builds prompt from issue context and additional prompt', () => {
    const context = {
      ref: resolveYouTrackIssueRef('MAP-123', 'https://wcmc.myjetbrains.com/youtrack'),
      title: 'Build YouTrack ingestion',
      body: 'Issue description',
      url: 'https://wcmc.myjetbrains.com/youtrack/issue/MAP-123',
      comments: [{ author: 'alice', body: 'Comment body', createdAt: '2026-04-22T00:00:00.000Z' }],
    };

    const prompt = buildYouTrackIssuePrompt(context, 'Use TypeScript');

    expect(prompt).toContain('Build from this YouTrack issue');
    expect(prompt).toContain('Build YouTrack ingestion');
    expect(prompt).toContain('Issue description');
    expect(prompt).toContain('Comment body');
    expect(prompt).toContain('Use TypeScript');
  });
});
