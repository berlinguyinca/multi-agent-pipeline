import type { DocumentationResult, QaAssessment } from './spec.js';
import type { GitHubReportResult } from './github.js';
import type { ConsensusDiagnostics, DAGResult, RouterRationale, StepResult, StepTerminalOutcome } from './dag.js';
import type { OllamaConfig } from './config.js';

export interface HeadlessOptions {
  prompt: string;
  githubIssueUrl?: string;
  initialSpec?: string;
  specFilePath?: string;
  outputDir?: string;
  workspaceDir?: string;
  configPath?: string;
  totalTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  pollIntervalMs?: number;
  routerTimeoutMs?: number;
  routerModel?: string;
  routerConsensusModels?: string[];
  disabledAgents?: string[];
  rerunPrompt?: string;
  compareAgents?: string[];
  semanticJudge?: boolean;
  judgePanelModels?: string[];
  judgePanelRoles?: string[];
  judgePanelSteer?: boolean;
  judgePanelMaxSteeringRounds?: number;
  ollama?: Partial<OllamaConfig>;
  personality?: string;
  verbose?: boolean;
}

export interface HeadlessRerunHints {
  command: string;
  disableAgentFlag: string;
  disabledAgents?: string[];
}

export interface HeadlessAgentContribution {
  agent: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  recoveredSteps: number;
  status: 'completed' | 'failed' | 'recovered' | 'mixed';
  tasks: string[];
  benefits: string[];
  evidence: string[];
  disableCommand?: string;
  selfOptimizationReason?: string;
}

export interface HeadlessAgentComparison {
  disabledAgent: string;
  baselineSuccess: boolean;
  variantSuccess: boolean;
  baselineDuration: number;
  variantDuration: number;
  finalSimilarity: number;
  recommendation: string;
  variantOutputDir: string;
}

export interface HeadlessSemanticJudge {
  enabled: boolean;
  method: 'deterministic-output-similarity';
  score: number;
  verdict: 'equivalent' | 'different' | 'needs-review';
}

export interface HeadlessJudgePanelVote {
  run: number;
  role?: string;
  provider?: string;
  model?: string;
  verdict: 'accept' | 'revise' | 'reject';
  confidence: number;
  improvements: string[];
  rationale: string;
  shouldSteer: boolean;
}

export interface HeadlessJudgePanelRound {
  round: number;
  verdict: 'accept' | 'revise' | 'reject';
  voteCount: number;
  votes: HeadlessJudgePanelVote[];
  improvements: string[];
  rationale: string;
}

export interface HeadlessJudgePanel {
  enabled: boolean;
  verdict: 'accept' | 'revise' | 'reject';
  voteCount: number;
  votes: HeadlessJudgePanelVote[];
  rounds?: HeadlessJudgePanelRound[];
  improvements: string[];
  rationale: string;
  steeringApplied: boolean;
  steeringPrompt?: string;
  steeringOutputDir?: string;
}

export interface HeadlessResult {
  version: 1;
  success: boolean;
  spec: string;
  filesCreated: string[];
  outputDir: string;
  workspaceDir?: string;
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
  workspaceDir?: string;
  markdownFiles: string[];
  duration: number;
  error?: string | null;
  githubReport?: GitHubReportResult;
  consensusDiagnostics?: ConsensusDiagnostics[];
  routerRationale?: RouterRationale;
  rerun?: HeadlessRerunHints;
  agentContributions?: HeadlessAgentContribution[];
  agentComparisons?: HeadlessAgentComparison[];
  semanticJudge?: HeadlessSemanticJudge;
  judgePanel?: HeadlessJudgePanel;
}
