import type {
  YouTrackIssueComment,
  YouTrackIssueContext,
  YouTrackIssueRef,
} from '../types/youtrack.js';
import { truncate } from '../utils/truncate.js';

type FetchLike = typeof fetch;

const PROMPT_MAX_CHARS = 80_000;
const ISSUE_ID_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/i;
const HTTP_URL_PATTERN = /^https?:\/\//i;

interface YouTrackIssueApiResponse {
  idReadable?: string;
  summary?: string;
  description?: string | null;
  comments?: YouTrackCommentApiResponse[];
}

interface YouTrackCommentApiResponse {
  text?: string | null;
  created?: number | string | null;
  author?: {
    login?: string;
    fullName?: string;
  } | null;
}

export function parseYouTrackIssueRef(value: string): YouTrackIssueRef {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('YouTrack issue URL must be a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('YouTrack issue URL must use https://');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const issueIndex = parts.indexOf('issue');
  const id = issueIndex >= 0 ? parts[issueIndex + 1] : undefined;
  if (!id || !ISSUE_ID_PATTERN.test(id)) {
    throw new Error('YouTrack issue URL must include /issue/<PROJECT-123>');
  }

  const baseParts = parts.slice(0, issueIndex);
  const baseUrl = normalizeBaseUrl(`${url.origin}${baseParts.length > 0 ? `/${baseParts.join('/')}` : ''}`);
  return buildRef(id, baseUrl);
}

export function resolveYouTrackIssueRef(value: string, baseUrl?: string): YouTrackIssueRef {
  const trimmed = value.trim();
  if (HTTP_URL_PATTERN.test(trimmed)) {
    return parseYouTrackIssueRef(trimmed);
  }
  if (!ISSUE_ID_PATTERN.test(trimmed)) {
    throw new Error('YouTrack issue id must look like PROJECT-123');
  }
  if (!baseUrl?.trim()) {
    throw new Error('YouTrack base URL is required when --youtrack-issue is an issue id');
  }
  return buildRef(trimmed.toUpperCase(), normalizeBaseUrl(baseUrl));
}

export function getYouTrackToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env['YOUTRACK_TOKEN']?.trim();
  return token === '' ? undefined : token;
}

export function getYouTrackBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const baseUrl = env['YOUTRACK_BASE_URL']?.trim();
  return baseUrl === '' ? undefined : baseUrl;
}

export async function fetchYouTrackIssueContext(
  ref: YouTrackIssueRef,
  token: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<YouTrackIssueContext> {
  const issue = await requestYouTrack<YouTrackIssueApiResponse>(
    issueApiUrl(ref),
    token,
    fetchImpl,
  );

  return {
    ref,
    title: issue.summary ?? issue.idReadable ?? ref.id,
    body: issue.description ?? '',
    url: ref.url,
    comments: (issue.comments ?? []).map(normalizeComment),
  };
}

export function buildYouTrackIssuePrompt(
  context: YouTrackIssueContext,
  additionalPrompt?: string,
): string {
  const commentsText =
    context.comments.length === 0
      ? '(no comments)'
      : context.comments
        .map(
          (comment) =>
            `### Comment by ${comment.author}${comment.createdAt ? ` at ${comment.createdAt}` : ''}\n${comment.body || '(empty)'}`,
        )
        .join('\n\n');

  const prompt = `Build from this YouTrack issue.

Issue: ${context.url}
Title: ${context.title}

## Issue Description
${context.body || '(empty)'}

## Issue Comments
${commentsText}
${additionalPrompt?.trim() ? `\n\n## Additional user prompt\n${additionalPrompt.trim()}` : ''}`;

  return truncate(prompt, PROMPT_MAX_CHARS, '\n\n[YouTrack issue prompt context truncated]\n');
}

function normalizeComment(comment: YouTrackCommentApiResponse): YouTrackIssueComment {
  return {
    author: comment.author?.fullName ?? comment.author?.login ?? 'unknown',
    body: comment.text ?? '',
    createdAt: normalizeCreatedAt(comment.created),
  };
}

function normalizeCreatedAt(created: number | string | null | undefined): string {
  if (typeof created === 'number') return new Date(created).toISOString();
  if (typeof created === 'string') return created;
  return '';
}

async function requestYouTrack<T>(
  url: string,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<T> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTrack API request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

function issueApiUrl(ref: YouTrackIssueRef): string {
  const fields = [
    'idReadable',
    'summary',
    'description',
    'comments(text,created,author(login,fullName))',
  ].join(',');
  return `${ref.baseUrl}/api/issues/${encodeURIComponent(ref.id)}?fields=${encodeURIComponent(fields)}`;
}

function buildRef(id: string, baseUrl: string): YouTrackIssueRef {
  return {
    id,
    baseUrl,
    url: `${baseUrl}/issue/${encodeURIComponent(id)}`,
  };
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
