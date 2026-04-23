import type {
  GitHubIssueComment,
  GitHubIssueContext,
  GitHubIssueRef,
  GitHubReportResult,
} from '../types/github.js';
import type { HeadlessResult, HeadlessResultV2 } from '../types/headless.js';
import { truncate } from '../utils/truncate.js';

type FetchLike = typeof fetch;

const API_VERSION = '2022-11-28';
const PROMPT_MAX_CHARS = 80_000;
const REPORT_MAX_CHARS = 60_000;

interface GitHubIssueApiResponse {
  html_url?: string;
  title?: string;
  body?: string | null;
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

export function parseGitHubIssueUrl(value: string): GitHubIssueRef {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('GitHub issue URL must be a valid URL');
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('GitHub issue URL must use https://github.com');
  }

  const [owner, repo, resource, issueNumberRaw, ...rest] = url.pathname
    .split('/')
    .filter(Boolean);

  if (!owner || !repo || resource !== 'issues' || !issueNumberRaw || rest.length > 0) {
    throw new Error('GitHub issue URL must look like https://github.com/owner/repo/issues/123');
  }

  const issueNumber = Number.parseInt(issueNumberRaw, 10);
  if (!Number.isInteger(issueNumber) || issueNumber < 1 || String(issueNumber) !== issueNumberRaw) {
    throw new Error('GitHub issue number must be a positive integer');
  }

  return {
    owner,
    repo,
    issueNumber,
    url: `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
  };
}

export function getGitHubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env['GITHUB_TOKEN']?.trim();
  return token === '' ? undefined : token;
}

export async function fetchGitHubIssueContext(
  ref: GitHubIssueRef,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<GitHubIssueContext> {
  const issue = await requestGitHub<GitHubIssueApiResponse>(
    issueApiUrl(ref),
    token,
    fetchImpl,
  );
  const comments = await requestGitHub<GitHubCommentApiResponse[]>(
    `${issueApiUrl(ref)}/comments?per_page=100`,
    token,
    fetchImpl,
  );

  return {
    ref,
    title: issue.title ?? '',
    body: issue.body ?? '',
    url: issue.html_url ?? ref.url,
    comments: comments
      .filter((comment) => comment.user?.type !== 'Bot')
      .map((comment): GitHubIssueComment => ({
        author: comment.user?.login ?? 'unknown',
        authorType: comment.user?.type ?? 'Unknown',
        body: comment.body ?? '',
        createdAt: comment.created_at ?? '',
      })),
  };
}

export function buildGitHubIssuePrompt(
  context: GitHubIssueContext,
  additionalPrompt?: string,
): string {
  const commentsText =
    context.comments.length === 0
      ? '(no non-bot comments)'
      : context.comments
          .map(
            (comment) =>
              `### Comment by ${comment.author}${comment.createdAt ? ` at ${comment.createdAt}` : ''}\n${comment.body || '(empty)'}`,
          )
          .join('\n\n');

  const prompt = `Build from this GitHub issue.

Issue: ${context.url}
Title: ${context.title}

## Issue Body
${context.body || '(empty)'}

## Issue Comments
${commentsText}
${additionalPrompt?.trim() ? `\n\n## Additional user prompt\n${additionalPrompt.trim()}` : ''}`;

  return truncate(prompt, PROMPT_MAX_CHARS, '\n\n[GitHub issue prompt context truncated]\n');
}

export async function postGitHubIssueComment(
  ref: GitHubIssueRef,
  token: string,
  body: string,
  fetchImpl: FetchLike = fetch,
): Promise<GitHubReportResult> {
  try {
    const response = await requestGitHub<GitHubCommentApiResponse>(
      `${issueApiUrl(ref)}/comments`,
      token,
      fetchImpl,
      {
        method: 'POST',
        body: JSON.stringify({ body: truncate(body, REPORT_MAX_CHARS, '\n\n[MAP report truncated]\n') }),
      },
    );

    return {
      issueUrl: ref.url,
      posted: true,
      commentUrl: response.html_url,
    };
  } catch (err) {
    return {
      issueUrl: ref.url,
      posted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function buildGitHubReport(
  result: HeadlessResult,
  context: GitHubIssueContext,
): string {
  const status = result.success ? 'Passed' : 'Failed';
  const qaLines = (result.qaAssessments ?? []).map(
    (assessment, index) =>
      `- ${assessment.target === 'spec' ? 'Spec QA' : 'Code QA'} iteration ${index + 1}: ${
        assessment.passed ? 'pass' : 'fail'
      }${assessment.summary ? ` - ${assessment.summary}` : ''}`,
  );
  const requiredChanges = (result.qaAssessments ?? [])
    .flatMap((assessment) => assessment.requiredChanges)
    .filter(Boolean);

  return `## MAP Pipeline Report

Status: ${status}
Issue: ${context.url}
Output: ${result.outputDir || '(none)'}
Duration: ${(result.duration / 1000).toFixed(1)}s

### Source Issue Interpretation
Used issue **${context.title || '(untitled)'}** as the source request.${context.comments.length > 0 ? ` Included ${context.comments.length} non-bot comment${context.comments.length === 1 ? '' : 's'}.` : ''}

### Execution Summary
- Files created: ${result.filesCreated.length}
- Markdown docs updated: ${result.documentationResult?.filesUpdated.length ?? 0}
- Tests: ${result.testsPassing}/${result.testsTotal} passing
- Failing tests: ${result.testsFailing}
${result.error ? `- Error: ${result.error}` : ''}

### QA Assessments
${qaLines.length > 0 ? qaLines.join('\n') : '- No QA assessments recorded.'}

### Required Changes Applied Through Loops
${requiredChanges.length > 0 ? requiredChanges.map((change) => `- ${change}`).join('\n') : '- No required changes were reported by QA.'}

<details>
<summary>Final Generated Spec</summary>

${result.spec || '(empty)'}

</details>

<details>
<summary>Raw QA Details</summary>

${formatRawQaDetails(result)}

</details>

Generated by MAP.`;
}

export function buildGitHubReportV2(
  result: HeadlessResultV2,
  context: GitHubIssueContext,
): string {
  const status = result.success ? 'Passed' : 'Failed';
  const completedSteps = result.steps.filter((step) => step.status === 'completed');
  const failedSteps = result.steps.filter((step) => step.status === 'failed');
  const skippedSteps = result.steps.filter((step) => step.status === 'skipped');
  const filesCreated = result.steps.flatMap((step) => step.filesCreated ?? []);

  const stepLines = result.steps.map((step) => {
    const detail = step.error ?? step.reason ?? step.output?.slice(0, 160);
    return `- ${step.id} [${step.agent}]: ${step.status}${detail ? ` - ${detail}` : ''}`;
  });

  return `## MAP Smart Routing Report

Status: ${status}
Issue: ${context.url}
Output: ${result.outputDir || '(none)'}
Duration: ${(result.duration / 1000).toFixed(1)}s
Outcome: ${result.outcome}

### Source Issue Interpretation
Used issue **${context.title || '(untitled)'}** as the source request.${context.comments.length > 0 ? ` Included ${context.comments.length} non-bot comment${context.comments.length === 1 ? '' : 's'}.` : ''}

### DAG Summary
- Steps: ${completedSteps.length}/${result.steps.length} completed
- Failed steps: ${failedSteps.length}
- Skipped steps: ${skippedSteps.length}
- Files created: ${filesCreated.length}
${result.error ? `- Error: ${result.error}` : ''}

### Step Results
${stepLines.length > 0 ? stepLines.join('\n') : '- No steps recorded.'}

Generated by MAP.`;
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

function issueApiUrl(ref: GitHubIssueRef): string {
  return `https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.issueNumber}`;
}

function formatRawQaDetails(result: HeadlessResult): string {
  const assessments = result.qaAssessments ?? [];
  if (assessments.length === 0) {
    return '(none)';
  }

  return assessments
    .map(
      (assessment, index) => `### ${index + 1}. ${assessment.target} QA

Result: ${assessment.passed ? 'pass' : 'fail'}
Summary: ${assessment.summary || '(none)'}

Findings:
${assessment.findings.length > 0 ? assessment.findings.map((finding) => `- ${finding}`).join('\n') : '- (none)'}

Required changes:
${assessment.requiredChanges.length > 0 ? assessment.requiredChanges.map((change) => `- ${change}`).join('\n') : '- (none)'}

Raw output:
\`\`\`
${assessment.rawOutput || '(empty)'}
\`\`\``,
    )
    .join('\n\n');
}
