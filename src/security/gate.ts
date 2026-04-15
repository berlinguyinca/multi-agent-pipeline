import type { AgentAdapter } from '../types/adapter.js';
import { runLLMReview } from './llm-review.js';
import { runStaticScan } from './scanner.js';
import type { SecurityConfig, SecurityFinding, SecurityScanResult } from './types.js';

export interface SecurityGateInput {
  content: string;
  agentName: string;
  task: string;
  config: SecurityConfig;
  createReviewAdapter?: () => AgentAdapter;
}

export async function runSecurityGate(input: SecurityGateInput): Promise<SecurityScanResult> {
  const start = Date.now();
  const { content, agentName, task, config } = input;

  if (!config.enabled) {
    return {
      passed: true,
      findings: [],
      staticFindings: [],
      llmFindings: [],
      duration: 0,
    };
  }

  let staticFindings: SecurityFinding[] = [];
  if (config.staticPatternsEnabled) {
    const staticResult = runStaticScan(content);
    staticFindings = staticResult.findings;
    if (!staticResult.passed) {
      return {
        passed: false,
        findings: staticFindings,
        staticFindings,
        llmFindings: [],
        duration: Date.now() - start,
      };
    }
  }

  let llmFindings: SecurityFinding[] = [];
  if (config.llmReviewEnabled && input.createReviewAdapter) {
    const llmResult = await runLLMReview({
      content,
      agentName,
      task,
      reviewAdapter: input.createReviewAdapter(),
    });
    llmFindings = llmResult.llmFindings;
    if (!llmResult.passed) {
      return {
        passed: false,
        findings: [...staticFindings, ...llmFindings],
        staticFindings,
        llmFindings,
        duration: Date.now() - start,
      };
    }
  }

  return {
    passed: true,
    findings: [...staticFindings, ...llmFindings],
    staticFindings,
    llmFindings,
    duration: Date.now() - start,
  };
}
