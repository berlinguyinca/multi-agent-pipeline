export type EvidenceSourceType = 'url' | 'document' | 'tool-output' | 'local-file' | 'knowledge' | 'model-prior';

export interface EvidenceSource {
  sourceType: EvidenceSourceType;
  title?: string;
  url?: string;
  retrievedAt?: string;
  publishedAt?: string;
  summary: string;
  supports: string;
  freshnessProfile?: string;
  snapshotPath?: string;
}

export interface ClaimEvidence {
  id: string;
  claim: string;
  claimType:
    | 'usage-classification'
    | 'commonness-score'
    | 'chemical-taxonomy'
    | 'code-change'
    | 'test-result'
    | 'documentation'
    | 'general-research';
  confidence: 'high' | 'medium' | 'low' | 'unavailable';
  timeframe?: 'current' | 'recent' | 'historical' | 'obsolete' | 'unavailable';
  recencyStatus?: 'current' | 'recent' | 'stale' | 'historical' | 'unavailable';
  commonnessScore?: number;
  evidence: EvidenceSource[];
}

export interface EvidenceGateFinding {
  severity: 'high' | 'medium' | 'low';
  claimId?: string;
  message: string;
}

export interface EvidenceGateResult {
  checked: boolean;
  passed: boolean;
  claims: ClaimEvidence[];
  findings: EvidenceGateFinding[];
}
