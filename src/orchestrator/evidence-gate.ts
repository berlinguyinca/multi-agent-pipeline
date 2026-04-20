import type { DAGStep, StepResult } from '../types/dag.js';
import type { EvidenceConfig } from '../types/config.js';
import type { ClaimEvidence, EvidenceGateFinding, EvidenceGateResult, EvidenceSource } from '../types/evidence.js';

const DEFAULT_REQUIRED_AGENTS = new Set([
  'usage-classification-tree',
]);

export function runEvidenceGate(options: {
  step: DAGStep;
  result: StepResult;
  config?: EvidenceConfig;
}): EvidenceGateResult {
  if (options.config?.enabled === false || options.config?.mode === 'off') {
    return { checked: false, passed: true, claims: [], findings: [] };
  }
  if (options.result.edgeType === 'feedback' && options.result.spawnedByAgent) {
    return { checked: false, passed: true, claims: [], findings: [] };
  }
  const requiredAgents = options.config
    ? new Set(options.config.requiredAgents)
    : DEFAULT_REQUIRED_AGENTS;
  const output = options.result.output ?? '';
  if (!requiredAgents.has(options.step.agent) && !/^##\s+Claim Evidence Ledger\s*$/im.test(output)) {
    return { checked: false, passed: true, claims: [], findings: [] };
  }

  const claims = extractClaimEvidenceLedger(output);
  const findings: EvidenceGateFinding[] = [];
  if (claims === null) {
    const draftClaims = buildDraftClaimEvidenceLedger(output);
    findings.push({
      severity: 'high',
      message: 'Claim Evidence Ledger is required for fact-critical usage classification output.',
    });
    return { checked: true, passed: false, claims: draftClaims, findings };
  }

  for (const claim of claims) {
    findings.push(...validateClaimEvidence(claim, options.config));
  }

  return {
    checked: true,
    passed: evidenceFindingsPass(findings, options.config),
    claims,
    findings,
  };
}

export function auditEvidenceText(markdown: string, config?: EvidenceConfig): EvidenceGateResult | null {
  const claims = extractClaimEvidenceLedger(markdown);
  if (claims === null) return null;
  const findings = claims.flatMap((claim) => validateClaimEvidence(claim, config));
  return {
    checked: true,
    passed: evidenceFindingsPass(findings, config),
    claims,
    findings,
  };
}

export function buildDraftClaimEvidenceLedger(markdown: string): ClaimEvidence[] {
  const candidates = markdown
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/^#+\s*/, '').replace(/^\|/, '').trim())
    .filter((line) =>
      line.length > 20 &&
      !line.includes('---') &&
      !/^rank\s*\|/i.test(line) &&
      !/^level\s*\|/i.test(line),
    )
    .slice(0, 10);

  return candidates.map((claim, index) => ({
    id: `draft-${index + 1}`,
    claim,
    claimType: inferDraftClaimType(claim),
    confidence: 'low',
    evidence: [{
      sourceType: 'model-prior',
      summary: 'Draft ledger entry generated from report text; requires direct evidence before downstream use.',
      supports: 'unsupported draft claim extraction',
    }],
  }));
}

function inferDraftClaimType(claim: string): ClaimEvidence['claimType'] {
  return /commonness|score|very common|rare|prevalen/i.test(claim)
    ? 'commonness-score'
    : /taxonomy|classyfire|chemont|kingdom|superclass/i.test(claim)
      ? 'chemical-taxonomy'
      : 'general-research';
}

function evidenceFindingsPass(findings: EvidenceGateFinding[], config: EvidenceConfig | undefined): boolean {
  if (config?.mode === 'warn') return true;
  if (config?.mode === 'high-stakes') return findings.length === 0;
  return !findings.some((finding) => finding.severity === 'high');
}

function validateClaimEvidence(claim: ClaimEvidence, config: EvidenceConfig | undefined): EvidenceGateFinding[] {
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
    findings.push(...validateCommonnessClaim(claim, config));
  }
  if (config?.blockUnsupportedCurrentClaims !== false && claim.timeframe === 'current' && claim.confidence !== 'unavailable') {
    if (claim.evidence.length === 0 || !claim.evidence.some((source) => supportsCurrentClaim(source, config, claim))) {
      const commonnessScore = claim.claimType === 'commonness-score' && typeof claim.commonnessScore === 'number'
        ? claim.commonnessScore
        : undefined;
      findings.push({
        severity: commonnessScore !== undefined && commonnessScore < 65 ? 'medium' : 'high',
        claimId: claim.id,
        message: 'Current claims require direct current/recent supporting evidence.',
      });
    }
  }
  return findings;
}

function validateCommonnessClaim(claim: ClaimEvidence, config: EvidenceConfig | undefined): EvidenceGateFinding[] {
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
      claim.evidence.some((source) => supportsCurrentUse(source, config, claim));
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

function freshnessMaxAgeDays(source: EvidenceSource, config: EvidenceConfig | undefined, claim?: Pick<ClaimEvidence, 'claimType'>): number {
  const profile = source.freshnessProfile;
  if (profile && config?.freshnessProfiles?.[profile]) {
    return config.freshnessProfiles[profile]!;
  }
  const claimProfile = claim ? freshnessProfileForClaimType(claim.claimType) : undefined;
  if (claimProfile && config?.freshnessProfiles?.[claimProfile]) {
    return config.freshnessProfiles[claimProfile]!;
  }
  return config?.currentClaimMaxSourceAgeDays ?? 730;
}

function freshnessProfileForClaimType(claimType: ClaimEvidence['claimType']): string | undefined {
  switch (claimType) {
    case 'commonness-score':
      return 'usage-commonness';
    case 'documentation':
      return 'software';
    case 'chemical-taxonomy':
      return 'chemical-taxonomy';
    default:
      return undefined;
  }
}

function supportsCurrentUse(source: EvidenceSource, config: EvidenceConfig | undefined, claim?: Pick<ClaimEvidence, 'claimType'>): boolean {
  if (!isAcceptablyFreshSource(source, config, claim)) {
    return false;
  }
  const combined = `${source.supports} ${source.summary}`.toLowerCase();
  return /\b(current|recent|ongoing|today|contemporary|prevalen|widespread)\b/.test(combined);
}

function supportsCurrentClaim(source: EvidenceSource, config: EvidenceConfig | undefined, claim?: Pick<ClaimEvidence, 'claimType'>): boolean {
  if ((claim?.claimType === 'usage-classification' || claim?.claimType === 'chemical-taxonomy') && source.sourceType === 'url' && source.retrievedAt?.trim()) {
    return true;
  }
  return isAcceptablyFreshSource(source, config, claim);
}

function isAcceptablyFreshSource(source: EvidenceSource, config: EvidenceConfig | undefined, claim?: Pick<ClaimEvidence, 'claimType'>): boolean {
  if (config?.requireRetrievedAtForWebClaims !== false && source.sourceType === 'url' && !source.retrievedAt?.trim()) {
    return false;
  }
  if (source.publishedAt && isOlderThan(source.publishedAt, freshnessMaxAgeDays(source, config, claim))) {
    return false;
  }
  return true;
}

function isOlderThan(value: string, maxAgeDays: number): boolean {
  const trimmed = value.trim();
  const yearOnly = /^(\d{4})$/.exec(trimmed);
  const date = yearOnly
    ? new Date(`${yearOnly[1]}-12-31T23:59:59Z`)
    : new Date(trimmed);
  if (Number.isNaN(date.valueOf())) return false;
  return Date.now() - date.valueOf() > maxAgeDays * 24 * 60 * 60 * 1000;
}

function extractClaimEvidenceLedger(markdown: string): ClaimEvidence[] | null {
  const heading = markdown.search(/^##\s+Claim Evidence Ledger\s*$/im);
  if (heading < 0) return null;
  const afterHeading = markdown.slice(heading);
  const fenced = afterHeading.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? sliceFirstJsonObject(afterHeading);
  if (!raw) return null;
  const parsed = parseEvidenceLedgerJson(raw);
  if (parsed === null) return null;
  const claimsRaw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed['claims'])
      ? parsed['claims']
      : [];
  return claimsRaw.filter(isRecord).map(normalizeClaimEvidence);
}

function parseEvidenceLedgerJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    try {
      return JSON.parse(repairEvidenceLedgerJson(raw)) as unknown;
    } catch {
      return null;
    }
  }
}

function repairEvidenceLedgerJson(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/(\"url\"\s*:\s*\"https?:\/\/[^\"]+)\"https?:\/\/[^\"]*\"/g, '$1\"');
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
  const retrievedAt = firstString(value, [
    'retrievedAt',
    'retrieved_at',
    'retrieved',
    'retrophiedAt',
    'retrieredAt',
    'retrivedAt',
  ]);
  return {
    sourceType: normalizeSourceType(value['sourceType']),
    ...(typeof value['title'] === 'string' ? { title: value['title'] } : {}),
    ...(typeof value['url'] === 'string' ? { url: value['url'] } : {}),
    ...(retrievedAt ? { retrievedAt } : {}),
    ...(typeof value['publishedAt'] === 'string' ? { publishedAt: value['publishedAt'] } : {}),
    summary: typeof value['summary'] === 'string' ? value['summary'] : '',
    supports: typeof value['supports'] === 'string' ? value['supports'] : '',
    ...(typeof value['freshnessProfile'] === 'string' ? { freshnessProfile: value['freshnessProfile'] } : {}),
  };
}

function firstString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return undefined;
}

function normalizeClaimType(value: unknown): ClaimEvidence['claimType'] {
  if (typeof value === 'string' && /^usage[-_]/i.test(value)) return 'usage-classification';
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
