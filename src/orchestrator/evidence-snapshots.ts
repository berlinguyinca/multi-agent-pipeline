import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DAGStep, StepResult } from '../types/dag.js';
import type { ClaimEvidence } from '../types/evidence.js';

export interface EvidenceSourceSnapshot {
  version: 1;
  stepId: string;
  agent: string;
  claimId: string;
  sourceIndex: number;
  capturedAt: string;
  source: ClaimEvidence['evidence'][number];
  contentHash: string;
}

export async function writeEvidenceSourceSnapshots(
  rootDir: string,
  step: Pick<DAGStep, 'id' | 'agent'>,
  result: StepResult,
): Promise<void> {
  const claims = result.evidenceGate?.claims ?? result.evidenceClaims ?? [];
  if (claims.length === 0) return;
  const snapshotDir = path.join(rootDir, '.map', 'evidence', 'sources');
  await fs.mkdir(snapshotDir, { recursive: true });
  for (const claim of claims) {
    for (const [index, source] of claim.evidence.entries()) {
      const snapshot: EvidenceSourceSnapshot = {
        version: 1,
        stepId: step.id,
        agent: step.agent,
        claimId: claim.id,
        sourceIndex: index,
        capturedAt: new Date().toISOString(),
        source,
        contentHash: hashSource(source),
      };
      const filename = `${safeSegment(step.id)}-${safeSegment(claim.id)}-${index}-${snapshot.contentHash.slice(0, 12)}.json`;
      const snapshotPath = path.join(snapshotDir, filename);
      await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      source.snapshotPath = path.relative(rootDir, snapshotPath);
    }
  }
}

function hashSource(source: ClaimEvidence['evidence'][number]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      sourceType: source.sourceType,
      title: source.title,
      url: source.url,
      retrievedAt: source.retrievedAt,
      publishedAt: source.publishedAt,
      summary: source.summary,
      supports: source.supports,
    }))
    .digest('hex');
}

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}
