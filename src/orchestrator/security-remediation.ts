import type { SecurityFinding } from '../security/types.js';

export function appendSecurityRemediationContext(
  context: string,
  remediationContext?: string,
): string {
  if (!remediationContext) return context;
  return `${context}\n\n${remediationContext}`;
}

export function buildSecurityRemediationContext(
  findings: SecurityFinding[],
  rejectedOutput: string,
): string {
  const formattedFindings = findings.length > 0
    ? findings.map(formatSecurityFinding).join('\n')
    : '- Security gate failed without structured findings. Re-check the output for unsafe behavior.';
  const outputExcerpt = rejectedOutput.length > 2_000
    ? `${rejectedOutput.slice(0, 2_000)}\n[truncated]`
    : rejectedOutput;

  return [
    '--- Security remediation required before this step can be accepted. ---',
    'The previous output was rejected by the security gate. Fix the issues below and return a corrected, complete output for the original task.',
    '',
    'Security findings:',
    formattedFindings,
    '',
    'Rejected output excerpt:',
    outputExcerpt,
    '',
    'Do not argue with the security review or restate these findings as the final answer. Produce the secure corrected result.',
  ].join('\n');
}

function formatSecurityFinding(finding: SecurityFinding): string {
  const location = finding.line !== undefined ? ` line ${finding.line}` : '';
  const snippet = finding.snippet ? ` Snippet: ${finding.snippet}` : '';
  return `- ${finding.severity.toUpperCase()} ${finding.rule}${location}: ${finding.message}.${snippet}`;
}
