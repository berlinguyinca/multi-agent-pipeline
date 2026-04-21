import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MetadataAdapter } from '../../src/adapters/metadata-adapter.js';

describe('MetadataAdapter pubchem-sync-builder', () => {
  it('creates a runnable PubChem sync project with 1000 markdown fixture records', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'map-pubchem-builder-'));
    const adapter = new MetadataAdapter('pubchem-sync-builder');
    let output = '';
    for await (const chunk of adapter.run('Build PubChem sync tool', { cwd })) output += chunk;

    expect(output).toContain('PubChem sync builder complete');
    expect(await fs.readFile(path.join(cwd, 'README.md'), 'utf8')).toContain('PubChem Sync Tool');
    const manifest = JSON.parse(await fs.readFile(path.join(cwd, 'sample-output/manifest.json'), 'utf8')) as { markdown_records: number };
    expect(manifest.markdown_records).toBe(1000);
    const files = await collectMarkdown(path.join(cwd, 'sample-output/records'));
    expect(files).toHaveLength(1000);
    await fs.rm(cwd, { recursive: true, force: true });
  });
});

async function collectMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collectMarkdown(full));
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

describe('MetadataAdapter legal-license-advisor', () => {
  it('renders license recommendations with a Claim Evidence Ledger', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'map-license-advisor-'));
    await fs.writeFile(path.join(cwd, 'pyproject.toml'), '[project]\nname = "tool"\n', 'utf8');
    await fs.writeFile(path.join(cwd, 'LICENSE'), 'MIT License\n', 'utf8');
    const adapter = new MetadataAdapter('legal-license-advisor');
    let output = '';
    for await (const chunk of adapter.run('Recommend licenses', { cwd })) output += chunk;
    expect(output).toContain('Not legal advice');
    expect(output).toContain('## Claim Evidence Ledger');
    expect(output).toContain('Apache-2.0');
    await fs.rm(cwd, { recursive: true, force: true });
  });
});

describe('MetadataAdapter docs-maintainer', () => {
  it('updates README with usage and license handoff', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'map-docs-maintainer-'));
    await fs.writeFile(path.join(cwd, 'README.md'), '# Tool\n', 'utf8');
    await fs.writeFile(path.join(cwd, 'LICENSE'), 'MIT License\n', 'utf8');
    const adapter = new MetadataAdapter('docs-maintainer');
    let output = '';
    for await (const chunk of adapter.run('Maintain docs', { cwd })) output += chunk;
    expect(output).toContain('Documentation maintained');
    expect(await fs.readFile(path.join(cwd, 'README.md'), 'utf8')).toContain('## MAP Handoff');
    await fs.rm(cwd, { recursive: true, force: true });
  });
});

describe('MetadataAdapter release-readiness-reviewer', () => {
  it('reports readiness with a Claim Evidence Ledger from local artifacts', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'map-release-ready-'));
    await fs.mkdir(path.join(cwd, 'sample-output/records/a/b'), { recursive: true });
    for (let index = 0; index < 1000; index += 1) await fs.writeFile(path.join(cwd, 'sample-output/records/a/b', `${index}.md`), '# x\n', 'utf8');
    await fs.writeFile(path.join(cwd, 'sample-output/manifest.json'), JSON.stringify({ markdown_records: 1000 }), 'utf8');
    await fs.writeFile(path.join(cwd, 'README.md'), '# Readme\n', 'utf8');
    await fs.writeFile(path.join(cwd, 'LICENSE'), 'MIT\n', 'utf8');
    const adapter = new MetadataAdapter('release-readiness-reviewer');
    let output = '';
    for await (const chunk of adapter.run('Assess readiness', { cwd })) output += chunk;
    expect(output).toContain('Verdict: ready');
    expect(output).toContain('## Claim Evidence Ledger');
    await fs.rm(cwd, { recursive: true, force: true });
  });
});

describe('MetadataAdapter code-qa-analyst', () => {
  it('accepts generated PubChem artifacts with structured QA JSON', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'map-code-qa-'));
    await fs.mkdir(path.join(cwd, 'sample-output/records/a/b'), { recursive: true });
    for (let index = 0; index < 1000; index += 1) await fs.writeFile(path.join(cwd, 'sample-output/records/a/b', `${index}.md`), '# x\n', 'utf8');
    await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'README.md'), '# Readme\n', 'utf8');
    await fs.writeFile(path.join(cwd, 'tests/test_pubchem_sync.py'), 'pass\n', 'utf8');
    const adapter = new MetadataAdapter('code-qa-analyst');
    let output = '';
    for await (const chunk of adapter.run('Review implementation', { cwd })) output += chunk;
    expect(output).toContain('"verdict": "accept"');
    await fs.rm(cwd, { recursive: true, force: true });
  });
});
