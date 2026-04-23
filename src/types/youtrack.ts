export interface YouTrackConfig {
  baseUrl?: string;
  token?: string;
}

export interface YouTrackIssueRef {
  id: string;
  baseUrl: string;
  url: string;
}

export interface YouTrackIssueComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface YouTrackIssueContext {
  ref: YouTrackIssueRef;
  title: string;
  body: string;
  url: string;
  comments: YouTrackIssueComment[];
}
