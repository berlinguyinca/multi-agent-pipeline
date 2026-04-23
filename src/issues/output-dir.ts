import { parseGitHubIssueUrl } from '../github/issues.js';
import { parseYouTrackIssueRef } from '../youtrack/issues.js';

const HTTP_URL_PATTERN = /^https?:\/\//i;

export function issueOutputDirName(options: {
  githubIssueUrl?: string;
  youtrackIssueUrl?: string;
}): string | undefined {
  if (options.githubIssueUrl?.trim()) {
    return sanitizeOutputDirName(String(parseGitHubIssueUrl(options.githubIssueUrl).issueNumber));
  }
  if (options.youtrackIssueUrl?.trim()) {
    const value = options.youtrackIssueUrl.trim();
    const id = HTTP_URL_PATTERN.test(value) ? parseYouTrackIssueRef(value).id : value;
    return sanitizeOutputDirName(id.toUpperCase());
  }
  return undefined;
}

function sanitizeOutputDirName(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'issue';
}
