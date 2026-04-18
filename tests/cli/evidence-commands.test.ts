import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { auditEvidenceDirectory, handleEvidenceCommand } from '../../src/cli/evidence-commands.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-evidence-audit-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('evidence commands', () => {
  it('audits claim evidence ledgers in markdown files', async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, 'report.md'), [
      '# Report',
      '',
      '## Claim Evidence Ledger',
      '',
      '```json',
      JSON.stringify({
        claims: [
          {
            id: 'claim-1',
            claim: 'Historical use is common today.',
            claimType: 'commonness-score',
            confidence: 'medium',
            timeframe: 'historical',
            recencyStatus: 'historical',
            commonnessScore: 90,
            evidence: [
              {
                sourceType: 'document',
                title: 'Old source',
                publishedAt: '1820',
                summary: 'Historical use only.',
                supports: 'historical use',
              },
            ],
          },
        ],
      }),
      '```',
    ].join('\n'));

    const audit = await auditEvidenceDirectory(dir);

    expect(audit.filesScanned).toBe(1);
    expect(audit.claimsTotal).toBe(1);
    expect(audit.findingsTotal).toBe(2);
    expect(audit.files[0]).toMatchObject({
      claims: 1,
      passed: false,
    });
    expect(audit.files[0].findings.map((finding) => finding.message)).toEqual(
      expect.arrayContaining([
        'Historical or obsolete practices cannot receive a current commonness score above 20.',
      ]),
    );
  });

  it('prints a readable audit summary', async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, 'report.md'), [
      '## Claim Evidence Ledger',
      '```json',
      JSON.stringify({ claims: [] }),
      '```',
    ].join('\n'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await handleEvidenceCommand(['audit', dir]);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Evidence Audit'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Files with ledgers: 1'));
  });

  it('explains a claim failure with concrete fix options', async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, 'report.md'), [
      '## Claim Evidence Ledger',
      '```json',
      JSON.stringify({
        claims: [{
          id: 'claim-3',
          claim: 'Historical practice is common today.',
          claimType: 'commonness-score',
          confidence: 'medium',
          timeframe: 'historical',
          recencyStatus: 'historical',
          commonnessScore: 90,
          evidence: [{ sourceType: 'document', title: 'Old text', publishedAt: '1700', summary: 'old', supports: 'historical use' }],
        }],
      }),
      '```',
    ].join('\n'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await handleEvidenceCommand(['explain', 'claim-3', dir]);

    const output = String(log.mock.calls.at(-1)?.[0] ?? '');
    expect(output).toContain('Claim claim-3');
    expect(output).toContain('Historical or obsolete practices cannot receive a current commonness score above 20');
    expect(output).toContain('Fix options');
    expect(output).toContain('Add current/recent evidence');
  });
});
