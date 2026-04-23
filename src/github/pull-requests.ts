import type {
  GitHubIssueComment,
  GitHubPRContext,
  GitHubPRFile,
  GitHubPRRef,
  PRReviewResult,
} from '../types/github.js';
import { truncate } from '../utils/truncate.js';

type FetchLike = typeof fetch;

const API_VERSION = '2022-11-28';
const DIFF_MAX_CHARS = 120_000;
const REVIEW_MAX_CHARS = 60_000;

interface GitHubPRApiResponse {
  html_url?: string;
  title?: string;
  body?: string | null;
  base?: { ref?: string };
  head?: { ref?: string };
}

interface GitHubPRFileApiResponse {
  filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

interface GitHubCommentApiResponse {
  html_url?: string;
  body?: string | null;
  created_at?: string;
  user?: {
    login?: string;
    type?: string;
  } | null;
}

export function parseGitHubPRUrl(value: string): GitHubPRRef {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('GitHub PR URL must be a valid URL');
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('GitHub PR URL must use https://github.com');
  }

  const [owner, repo, resource, pullNumberRaw, ...rest] = url.pathname
    .split('/')
    .filter(Boolean);

  if (!owner || !repo || resource !== 'pull' || !pullNumberRaw || rest.length > 0) {
    throw new Error('GitHub PR URL must look like https://github.com/owner/repo/pull/123');
  }

  const pullNumber = Number.parseInt(pullNumberRaw, 10);
  if (!Number.isInteger(pullNumber) || pullNumber < 1 || String(pullNumber) !== pullNumberRaw) {
    throw new Error('GitHub PR number must be a positive integer');
  }

  return {
    owner,
    repo,
    pullNumber,
    url: `https://github.com/${owner}/${repo}/pull/${pullNumber}`,
  };
}

export async function fetchGitHubPRContext(
  ref: GitHubPRRef,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<GitHubPRContext> {
  const pr = await requestGitHub<GitHubPRApiResponse>(
    prApiUrl(ref),
    token,
    fetchImpl,
  );

  const filesRaw = await requestGitHub<GitHubPRFileApiResponse[]>(
    `${prApiUrl(ref)}/files?per_page=100`,
    token,
    fetchImpl,
  );

  const commentsRaw = await requestGitHub<GitHubCommentApiResponse[]>(
    `${prApiUrl(ref)}/comments?per_page=100`,
    token,
    fetchImpl,
  );

  const files: GitHubPRFile[] = filesRaw.map((file) => ({
    filename: file.filename ?? '',
    status: file.status ?? 'unknown',
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    patch: file.patch,
  }));

  const comments: GitHubIssueComment[] = commentsRaw
    .filter((comment) => comment.user?.type !== 'Bot')
    .map((comment) => ({
      author: comment.user?.login ?? 'unknown',
      authorType: comment.user?.type ?? 'Unknown',
      body: comment.body ?? '',
      createdAt: comment.created_at ?? '',
    }));

  return {
    ref,
    title: pr.title ?? '',
    body: pr.body ?? '',
    url: pr.html_url ?? ref.url,
    baseBranch: pr.base?.ref ?? 'unknown',
    headBranch: pr.head?.ref ?? 'unknown',
    files,
    comments,
  };
}

export function buildPRReviewPrompt(context: GitHubPRContext): string {
  const filesSummary = context.files
    .map(
      (file) =>
        `- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})`,
    )
    .join('\n');

  const patches = context.files
    .filter((file) => file.patch)
    .map((file) => `### ${file.filename}\n\`\`\`diff\n${file.patch}\n\`\`\``)
    .join('\n\n');

  const commentsText =
    context.comments.length === 0
      ? '(no review comments)'
      : context.comments
          .map(
            (comment) =>
              `### Comment by ${comment.author}${comment.createdAt ? ` at ${comment.createdAt}` : ''}\n${comment.body || '(empty)'}`,
          )
          .join('\n\n');

  const prompt = `Review this GitHub pull request.

PR: ${context.url}
Title: ${context.title}
Branch: ${context.headBranch} → ${context.baseBranch}

## PR Description
${context.body || '(empty)'}

## Files Changed
${filesSummary}

## Diff
${patches || '(no patches available)'}

## Existing Review Comments
${commentsText}`;

  return truncate(prompt, DIFF_MAX_CHARS, '\n\n[PR diff context truncated]\n');
}

export async function postGitHubPRReview(
  ref: GitHubPRRef,
  token: string,
  body: string,
  fetchImpl: FetchLike = fetch,
): Promise<PRReviewResult> {
  try {
    const response = await requestGitHub<GitHubCommentApiResponse>(
      issueCommentsUrl(ref),
      token,
      fetchImpl,
      {
        method: 'POST',
        body: JSON.stringify({
          body: truncate(body, REVIEW_MAX_CHARS, '\n\n[MAP review truncated]\n'),
        }),
      },
    );

    return {
      prUrl: ref.url,
      posted: true,
      commentUrl: response.html_url,
    };
  } catch (err) {
    return {
      prUrl: ref.url,
      posted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function mergeGitHubPR(
  ref: GitHubPRRef,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<PRReviewResult> {
  try {
    const response = await requestGitHub<{ html_url?: string; merged?: boolean; sha?: string; message?: string }>(
      `${prApiUrl(ref)}/merge`,
      token,
      fetchImpl,
      {
        method: 'PUT',
        body: JSON.stringify({}),
      },
    );

    return {
      prUrl: ref.url,
      posted: false,
      merged: response.merged === true,
      mergeUrl: response.html_url,
      mergeMethod: 'default',
    };
  } catch (err) {
    return {
      prUrl: ref.url,
      posted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function requestGitHub<T>(
  url: string,
  token: string,
  fetchImpl: FetchLike,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': API_VERSION,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

function prApiUrl(ref: GitHubPRRef): string {
  return `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.pullNumber}`;
}

function issueCommentsUrl(ref: GitHubPRRef): string {
  return `https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.pullNumber}/comments`;
}
