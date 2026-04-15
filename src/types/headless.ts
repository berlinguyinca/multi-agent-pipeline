import type { DocumentationResult, QaAssessment } from './spec.js';
import type { GitHubReportResult } from './github.js';
import type { DAGResult, StepResult, StepTerminalOutcome } from './dag.js';

export interface HeadlessOptions {
  prompt: string;
  githubIssueUrl?: string;
  initialSpec?: string;
  specFilePath?: string;
  outputDir?: string;
  configPath?: string;
  totalTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  pollIntervalMs?: number;
  routerTimeoutMs?: number;
  routerModel?: string;
  routerConsensusModels?: string[];
  personality?: string;
  verbose?: boolean;
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
  markdownFiles?: string[];
  specFilePath?: string;
  error?: string;
}

export interface HeadlessResultV2 {
  version: 2;
  success: boolean;
  outcome: StepTerminalOutcome;
  dag: DAGResult;
  steps: StepResult[];
  outputDir: string;
  markdownFiles: string[];
  duration: number;
  error?: string | null;
  githubReport?: GitHubReportResult;
}
