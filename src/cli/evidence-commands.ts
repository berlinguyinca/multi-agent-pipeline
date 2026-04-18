import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { auditEvidenceText } from '../orchestrator/evidence-gate.js';
import type { EvidenceConfig } from '../types/config.js';
import type { EvidenceGateFinding } from '../types/evidence.js';

export interface EvidenceAuditFile {
  path: string;
  claims: number;
  findings: EvidenceGateFinding[];
  passed: boolean;
}

export interface EvidenceAuditResult {
  root: string;
  filesScanned: number;
  files: EvidenceAuditFile[];
  claimsTotal: number;
  findingsTotal: number;
  passed: boolean;
}

const AUDIT_EXTENSIONS = new Set(['.md', '.markdown', '.json']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.map/worktrees']);

export async function handleEvidenceCommand(args: string[]): Promise<void> {
  const action = args[0];
  if (action !== 'audit') {
    console.log([
      'Usage:',
      '  map evidence audit [path]',
      '',
      'Scans Markdown/JSON artifacts for Claim Evidence Ledger sections and reports deterministic evidence-gate findings.',
    ].join('\n'));
    return;
  }

  const target = args.find((arg, index) => index > 0 && !arg.startsWith('--')) ?? process.cwd();
  const asJson = args.includes('--json');
  const audit = await auditEvidenceDirectory(target);
  console.log(asJson ? JSON.stringify(audit, null, 2) : formatEvidenceAudit(audit));
}

export async function auditEvidenceDirectory(
  root: string,
  config: EvidenceConfig = DEFAULT_CONFIG.evidence,
): Promise<EvidenceAuditResult> {
  const resolvedRoot = path.resolve(root);
  const files = await collectAuditFiles(resolvedRoot);
  const audited: EvidenceAuditFile[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const gate = auditEvidenceText(text, config);
    if (!gate) continue;
    audited.push({
      path: file,
      claims: gate.claims.length,
      findings: gate.findings,
      passed: gate.passed,
    });
  }

  return {
    root: resolvedRoot,
    filesScanned: audited.length,
    files: audited,
    claimsTotal: audited.reduce((sum, file) => sum + file.claims, 0),
    findingsTotal: audited.reduce((sum, file) => sum + file.findings.length, 0),
    passed: audited.every((file) => file.passed),
  };
}

function formatEvidenceAudit(audit: EvidenceAuditResult): string {
  const lines = [
    '# Evidence Audit',
    '',
    `Root: ${audit.root}`,
    `Files with ledgers: ${audit.filesScanned}`,
    `Claims: ${audit.claimsTotal}`,
    `Findings: ${audit.findingsTotal}`,
    `Status: ${audit.passed ? 'pass' : 'fail'}`,
  ];
  for (const file of audit.files) {
    lines.push('', `## ${path.relative(audit.root, file.path) || path.basename(file.path)}`, `Claims: ${file.claims}`, `Status: ${file.passed ? 'pass' : 'fail'}`);
    for (const finding of file.findings) {
      lines.push(`- ${finding.severity}${finding.claimId ? ` ${finding.claimId}` : ''}: ${finding.message}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function collectAuditFiles(root: string): Promise<string[]> {
  const stat = await fs.stat(root);
  if (stat.isFile()) return AUDIT_EXTENSIONS.has(path.extname(root).toLowerCase()) ? [root] : [];
  const results: string[] = [];
  await walk(root, results);
  return results;
}

async function walk(dir: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const rel = path.relative(process.cwd(), fullPath);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(rel)) continue;
      await walk(fullPath, results);
      continue;
    }
    if (entry.isFile() && AUDIT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
}
