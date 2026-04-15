export interface GitHubIssueRef {
  owner: string;
  repo: string;
  issueNumber: number;
  url: string;
}

export interface GitHubIssueComment {
  author: string;
  authorType: string;
  body: string;
  createdAt: string;
}

export interface GitHubIssueContext {
  ref: GitHubIssueRef;
  title: string;
  body: string;
  url: string;
  comments: GitHubIssueComment[];
}

export interface GitHubReportResult {
  issueUrl: string;
  posted: boolean;
  commentUrl?: string;
  merged?: boolean;
  mergeUrl?: string;
  mergeMethod?: string;
  error?: string;
}

export interface GitHubPRRef {
  owner: string;
  repo: string;
  pullNumber: number;
  url: string;
}

export interface GitHubPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface GitHubPRContext {
  ref: GitHubPRRef;
  title: string;
  body: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  files: GitHubPRFile[];
  comments: GitHubIssueComment[];
}

export interface PRReviewResult {
  prUrl: string;
  posted: boolean;
  commentUrl?: string;
  merged?: boolean;
  mergeUrl?: string;
  mergeMethod?: string;
  error?: string;
}
