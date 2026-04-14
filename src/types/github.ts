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
  error?: string;
}
