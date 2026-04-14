import type { DocumentationResult, QaAssessment } from './spec.js';
import type { GitHubReportResult } from './github.js';

export interface HeadlessOptions {
  prompt: string;
  githubIssueUrl?: string;
  outputDir?: string;
  configPath?: string;
  totalTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  pollIntervalMs?: number;
  personality?: string;
}

export interface HeadlessResult {
  version: 1;
  success: boolean;
  spec: string;
  filesCreated: string[];
  outputDir: string;
  testsTotal: number;
  testsPassing: number;
  testsFailing: number;
  duration: number;
  qaAssessments?: QaAssessment[];
  documentationResult?: DocumentationResult;
  githubReport?: GitHubReportResult;
  error?: string;
}
