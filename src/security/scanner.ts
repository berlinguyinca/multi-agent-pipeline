import type { SecurityFinding } from './types.js';
import { matchPatterns } from './patterns.js';

export interface StaticScanResult {
  passed: boolean;
  findings: SecurityFinding[];
  duration: number;
}

export function runStaticScan(content: string): StaticScanResult {
  const start = Date.now();
  const findings = matchPatterns(content);
  return {
    passed: findings.length === 0,
    findings,
    duration: Date.now() - start,
  };
}
