import type { AdapterType } from '../types/adapter.js';

export interface SecurityConfig {
  enabled: boolean;
  maxRemediationRetries: number;
  adapter: AdapterType;
  model?: string;
  staticPatternsEnabled: boolean;
  llmReviewEnabled: boolean;
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enabled: true,
  maxRemediationRetries: 2,
  adapter: 'ollama',
  model: 'gemma4:26b',
  staticPatternsEnabled: true,
  llmReviewEnabled: true,
};

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface SecurityFinding {
  rule: string;
  severity: SecuritySeverity;
  message: string;
  line?: number;
  snippet?: string;
}

export interface SecurityScanResult {
  passed: boolean;
  findings: SecurityFinding[];
  staticFindings: SecurityFinding[];
  llmFindings: SecurityFinding[];
  duration: number;
}
