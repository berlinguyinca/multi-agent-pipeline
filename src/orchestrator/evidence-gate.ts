import type { DAGStep, StepResult } from '../types/dag.js';
import type { ClaimEvidence, EvidenceGateFinding, EvidenceGateResult, EvidenceSource } from '../types/evidence.js';

const EVIDENCE_REQUIRED_AGENTS = new Set([
  'usage-classification-tree',
]);

export function runEvidenceGate(options: {
  step: DAGStep;
  result: StepResult;
}): EvidenceGateResult {
  if (!EVIDENCE_REQUIRED_AGENTS.has(options.step.agent)) {
    return { checked: false, passed: true, claims: [], findings: [] };
  }

  const claims = extractClaimEvidenceLedger(options.result.output ?? '');
  const findings: EvidenceGateFinding[] = [];
  if (claims === null) {
    findings.push({
      severity: 'high',
      message: 'Claim Evidence Ledger is required for fact-critical usage classification output.',
    });
    return { checked: true, passed: false, claims: [], findings };
  }

  for (const claim of claims) {
    findings.push(...validateClaimEvidence(claim));
  }

  return {
    checked: true,
    passed: !findings.some((finding) => finding.severity === 'high'),
    claims,
    findings,
  };
}

function validateClaimEvidence(claim: ClaimEvidence): EvidenceGateFinding[] {
  const findings: EvidenceGateFinding[] = [];
  if (!claim.id.trim()) {
    findings.push({ severity: 'high', message: 'Evidence claim is missing an id.' });
  }
  if (!claim.claim.trim()) {
    findings.push({ severity: 'high', claimId: claim.id, message: 'Evidence claim text is empty.' });
  }
  if (claim.confidence !== 'unavailable' && claim.evidence.length === 0) {
    findings.push({
      severity: 'high',
      claimId: claim.id,
      message: 'Supported claims must include at least one evidence source.',
    });
  }
  if (claim.confidence === 'high' && claim.evidence.length > 0 && claim.evidence.every((source) => source.sourceType === 'model-prior')) {
    findings.push({
      severity: 'high',
      claimId: claim.id,
      message: 'High-confidence claims cannot be supported only by model-prior evidence.',
    });
  }
  if (claim.claimType === 'commonness-score') {
    findings.push(...validateCommonnessClaim(claim));
  }
  return findings;
}

function validateCommonnessClaim(claim: ClaimEvidence): EvidenceGateFinding[] {
  const findings: EvidenceGateFinding[] = [];
  const score = typeof claim.commonnessScore === 'number' ? claim.commonnessScore : undefined;
  if (score !== undefined && (!Number.isInteger(score) || score < 0 || score > 100)) {
    findings.push({
      severity: 'high',
      claimId: claim.id,
      message: 'Commonness score must be an integer from 0 to 100.',
    });
  }
  if ((claim.timeframe === 'historical' || claim.timeframe === 'obsolete') && (score ?? 0) > 20) {
    findings.push({
      severity: 'high',
      claimId: claim.id,
      message: 'Historical or obsolete practices cannot receive a current commonness score above 20.',
    });
  }
  if ((score ?? 0) >= 65) {
    const hasCurrentEvidence =
      claim.timeframe === 'current' &&
      (claim.recencyStatus === 'current' || claim.recencyStatus === 'recent') &&
      claim.evidence.some(supportsCurrentUse);
    if (!hasCurrentEvidence) {
      findings.push({
        severity: 'high',
        claimId: claim.id,
        message: 'High commonness scores require current/recent prevalence evidence.',
      });
    }
  }
  return findings;
}

function supportsCurrentUse(source: EvidenceSource): boolean {
  const combined = `${source.supports} ${source.summary}`.toLowerCase();
  return /\b(current|recent|ongoing|today|contemporary|prevalen|widespread)\b/.test(combined);
}

function extractClaimEvidenceLedger(markdown: string): ClaimEvidence[] | null {
  const heading = markdown.search(/^##\s+Claim Evidence Ledger\s*$/im);
  if (heading < 0) return null;
  const afterHeading = markdown.slice(heading);
  const fenced = afterHeading.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? sliceFirstJsonObject(afterHeading);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const claimsRaw = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed['claims'])
        ? parsed['claims']
        : [];
    return claimsRaw.filter(isRecord).map(normalizeClaimEvidence);
  } catch {
    return null;
  }
}

function normalizeClaimEvidence(value: Record<string, unknown>): ClaimEvidence {
  return {
    id: typeof value['id'] === 'string' ? value['id'] : '',
    claim: typeof value['claim'] === 'string' ? value['claim'] : '',
    claimType: normalizeClaimType(value['claimType']),
    confidence: normalizeConfidence(value['confidence']),
    ...(normalizeTimeframe(value['timeframe']) ? { timeframe: normalizeTimeframe(value['timeframe']) } : {}),
    ...(normalizeRecencyStatus(value['recencyStatus']) ? { recencyStatus: normalizeRecencyStatus(value['recencyStatus']) } : {}),
    ...(typeof value['commonnessScore'] === 'number' ? { commonnessScore: value['commonnessScore'] } : {}),
    evidence: Array.isArray(value['evidence'])
      ? value['evidence'].filter(isRecord).map(normalizeEvidenceSource)
      : [],
  };
}

function normalizeEvidenceSource(value: Record<string, unknown>): EvidenceSource {
  return {
    sourceType: normalizeSourceType(value['sourceType']),
    ...(typeof value['title'] === 'string' ? { title: value['title'] } : {}),
    ...(typeof value['url'] === 'string' ? { url: value['url'] } : {}),
    ...(typeof value['retrievedAt'] === 'string' ? { retrievedAt: value['retrievedAt'] } : {}),
    ...(typeof value['publishedAt'] === 'string' ? { publishedAt: value['publishedAt'] } : {}),
    summary: typeof value['summary'] === 'string' ? value['summary'] : '',
    supports: typeof value['supports'] === 'string' ? value['supports'] : '',
  };
}

function normalizeClaimType(value: unknown): ClaimEvidence['claimType'] {
  return value === 'usage-classification' ||
    value === 'commonness-score' ||
    value === 'chemical-taxonomy' ||
    value === 'code-change' ||
    value === 'test-result' ||
    value === 'documentation' ||
    value === 'general-research'
    ? value
    : 'general-research';
}

function normalizeConfidence(value: unknown): ClaimEvidence['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low' || value === 'unavailable'
    ? value
    : 'unavailable';
}

function normalizeTimeframe(value: unknown): ClaimEvidence['timeframe'] | undefined {
  return value === 'current' || value === 'recent' || value === 'historical' || value === 'obsolete' || value === 'unavailable'
    ? value
    : undefined;
}

function normalizeRecencyStatus(value: unknown): ClaimEvidence['recencyStatus'] | undefined {
  return value === 'current' || value === 'recent' || value === 'stale' || value === 'historical' || value === 'unavailable'
    ? value
    : undefined;
}

function normalizeSourceType(value: unknown): EvidenceSource['sourceType'] {
  return value === 'url' || value === 'document' || value === 'tool-output' || value === 'local-file' || value === 'knowledge' || value === 'model-prior'
    ? value
    : 'model-prior';
}

function sliceFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
