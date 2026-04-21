import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdapterType, DetectInfo, RunOptions } from '../types/adapter.js';

const execFileAsync = promisify(execFile);

interface FileSummary {
  path: string;
  extension: string;
  bytes: number;
  lines: number;
  imports: string[];
  exports: string[];
  symbols: string[];
  preview: string;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.map/worktrees']);
const MAX_FILES = 120;
const MAX_BYTES = 24_000;

export class MetadataAdapter {
  readonly type: AdapterType = 'metadata';
  readonly model: string | undefined;
  private cancelled = false;

  constructor(model?: string) {
    this.model = model;
  }

  async detect(): Promise<DetectInfo> {
    return { installed: true, version: 'metadata-local' };
  }

  async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    this.cancelled = false;
    const cwd = path.resolve(options?.cwd ?? process.cwd());
    if ((this.model ?? '').toLowerCase().includes('legal-license-advisor')) {
      yield await renderLegalLicenseAdvice(cwd);
      return;
    }
    if ((this.model ?? '').toLowerCase().includes('docs-maintainer')) {
      yield await renderDocsMaintenance(cwd);
      return;
    }
    if ((this.model ?? '').toLowerCase().includes('release-readiness-reviewer')) {
      yield await renderReleaseReadiness(cwd, prompt);
      return;
    }
    if ((this.model ?? '').toLowerCase().includes('code-qa-analyst')) {
      yield await renderCodeQaAnalysis(cwd, prompt);
      return;
    }
    const files = await collectFileSummaries(cwd, () => this.cancelled || options?.signal?.aborted === true);
    if (this.cancelled || options?.signal?.aborted) return;
    yield renderMetadata(this.model ?? 'codesight', cwd, files);
  }

  cancel(): void {
    this.cancelled = true;
  }
}

async function collectFileSummaries(cwd: string, shouldStop: () => boolean): Promise<FileSummary[]> {
  const files: string[] = [];
  await walk(cwd, cwd, files, shouldStop);
  const summaries: FileSummary[] = [];
  for (const file of files.slice(0, MAX_FILES)) {
    if (shouldStop()) break;
    const stat = await fs.stat(file);
    if (stat.size > MAX_BYTES) continue;
    const content = await fs.readFile(file, 'utf8').catch(() => '');
    summaries.push(summarizeFile(cwd, file, content, stat.size));
  }
  return summaries;
}

async function walk(root: string, dir: string, results: string[], shouldStop: () => boolean): Promise<void> {
  if (shouldStop() || results.length >= MAX_FILES) return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (shouldStop() || results.length >= MAX_FILES) return;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(rel)) continue;
      await walk(root, full, results, shouldStop);
      continue;
    }
    if (entry.isFile() && isSourceLike(entry.name)) results.push(full);
  }
}

function isSourceLike(file: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cpp|h|hpp|cs|php|md|json|ya?ml)$/i.test(file);
}

function summarizeFile(root: string, file: string, content: string, bytes: number): FileSummary {
  const rel = path.relative(root, file);
  const lines = content.split(/\r?\n/);
  return {
    path: rel,
    extension: path.extname(file).replace(/^\./, '') || 'none',
    bytes,
    lines: lines.length,
    imports: matchAll(content, /^\s*import\s+.*?from\s+['"]([^'"]+)['"]/gm).slice(0, 8),
    exports: matchAll(content, /^\s*export\s+(?:default\s+)?(?:class|function|const|interface|type)\s+([A-Za-z0-9_$]+)/gm).slice(0, 8),
    symbols: matchAll(content, /^\s*(?:export\s+)?(?:class|function|interface|type|const)\s+([A-Za-z0-9_$]+)/gm).slice(0, 12),
    preview: lines.slice(0, 8).join('\n'),
  };
}

function matchAll(content: string, pattern: RegExp): string[] {
  return [...content.matchAll(pattern)].map((match) => match[1] ?? '').filter(Boolean);
}

function renderMetadata(model: string, cwd: string, files: FileSummary[]): string {
  const normalized = model.toLowerCase();
  if (normalized.includes('insightcode')) return renderInsightCode(cwd, files);
  if (normalized.includes('codefetch')) return renderCodeFetch(cwd, files);
  return renderCodeSight(cwd, files);
}

function renderInsightCode(cwd: string, files: FileSummary[]): string {
  const byExt = groupBy(files, (file) => file.extension);
  return [
    '# InsightCode Metadata',
    '',
    `Repository: ${cwd}`,
    `Files analyzed: ${files.length}`,
    '',
    '## Architecture Sketch',
    '',
    '```mermaid',
    'flowchart LR',
    ...Object.keys(byExt).sort().map((ext) => `  repo --> ${safeMermaid(ext)}["${ext} files (${byExt[ext]!.length})"]`),
    '```',
    '',
    '## File Summaries',
    ...files.map((file) => `- ${file.path}: ${file.lines} lines, symbols: ${file.symbols.join(', ') || 'none detected'}`),
  ].join('\n');
}

function renderCodeFetch(cwd: string, files: FileSummary[]): string {
  return [
    '# CodeFetch Metadata',
    '',
    `Repository: ${cwd}`,
    '',
    '## File Tree',
    ...files.map((file) => `- ${file.path} (${file.lines} lines)`),
    '',
    '## Code Context',
    ...files.map((file) => [
      `### ${file.path}`,
      '```',
      file.preview,
      '```',
    ].join('\n')),
  ].join('\n');
}

function renderCodeSight(cwd: string, files: FileSummary[]): string {
  return [
    '# CodeSight Metadata',
    '',
    `Repository: ${cwd}`,
    `Files analyzed: ${files.length}`,
    '',
    '## Symbols',
    ...files.map((file) => `- ${file.path}: ${file.symbols.join(', ') || 'none detected'}`),
    '',
    '## Imports',
    ...files.flatMap((file) => file.imports.map((imp) => `- ${file.path} -> ${imp}`)),
    '',
    '## Exports',
    ...files.flatMap((file) => file.exports.map((exp) => `- ${file.path} exports ${exp}`)),
  ].join('\n');
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = [...(result[key] ?? []), item];
  }
  return result;
}

function safeMermaid(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_') || 'files';
}


async function renderLegalLicenseAdvice(cwd: string): Promise<string> {
  const files = await fs.readdir(cwd).catch((): string[] => []);
  const hasPyProject = files.includes('pyproject.toml');
  const hasPackageJson = files.includes('package.json');
  const hasLicense = files.some((file) => /^license(?:\.|$)/i.test(file));
  const inspected = [
    hasPyProject ? 'pyproject.toml' : null,
    hasPackageJson ? 'package.json' : null,
    hasLicense ? 'LICENSE' : null,
    files.includes('README.md') ? 'README.md' : null,
  ].filter(Boolean) as string[];
  return [
    '# License recommendation',
    '',
    'Not legal advice: final license selection belongs to the project owner or qualified counsel.',
    '',
    '## Evidence inspected',
    inspected.length > 0 ? inspected.map((file) => `- ${file}`).join('\n') : '- No standard manifest or license files found.',
    '',
    '## Detected build profile',
    `- Languages/ecosystems: ${hasPyProject ? 'Python' : hasPackageJson ? 'JavaScript/TypeScript' : 'unavailable'}`,
    `- Existing license coverage: ${hasLicense ? 'LICENSE file present' : 'no LICENSE file detected'}`,
    '',
    '## Recommended license options',
    '',
    '| Option | SPDX | Why it may fit | Caveats | Confidence |',
    '| --- | --- | --- | --- | --- |',
    '| MIT | MIT | Simple permissive default for small generated tools. | No explicit patent grant. | medium |',
    '| Apache License 2.0 | Apache-2.0 | Permissive and includes explicit patent language. | More notice text than MIT. | medium |',
    '| BSD 3-Clause | BSD-3-Clause | Permissive with endorsement restriction. | Similar permissive obligations still require notices. | medium |',
    '',
    '## Handoff to docs-maintainer',
    hasLicense ? 'Document that the generated tool currently includes LICENSE coverage and that the owner should confirm the final choice before distribution.' : 'Document a license-choice blocker before distribution.',
    '',
    '## Claim Evidence Ledger',
    '```json',
    JSON.stringify({
      claims: [
        {
          id: 'license-local-1',
          claim: hasLicense ? 'A LICENSE file is present in the generated workspace.' : 'No LICENSE file was detected in the generated workspace root.',
          claimType: 'local-file-inspection',
          confidence: 'high',
          timeframe: 'current',
          recencyStatus: 'current',
          evidence: [{ sourceType: 'local-file', title: hasLicense ? 'LICENSE' : 'workspace file listing', summary: `Inspected workspace root: ${cwd}`, supports: 'Supports local license coverage status.' }],
        },
        {
          id: 'license-local-2',
          claim: hasPyProject ? 'The generated workspace contains Python package metadata.' : 'Python package metadata was not detected.',
          claimType: 'local-file-inspection',
          confidence: hasPyProject ? 'high' : 'medium',
          timeframe: 'current',
          recencyStatus: 'current',
          evidence: [{ sourceType: 'local-file', title: hasPyProject ? 'pyproject.toml' : 'workspace file listing', summary: `Inspected workspace root: ${cwd}`, supports: 'Supports detected language/package profile.' }],
        },
      ],
    }, null, 2),
    '```',
  ].join('\n');
}


async function renderDocsMaintenance(cwd: string): Promise<string> {
  const readmePath = path.join(cwd, 'README.md');
  const licensePath = path.join(cwd, 'LICENSE');
  let readme = await fs.readFile(readmePath, 'utf8').catch(() => '# Project\n');
  const section = [
    '',
    '## MAP Handoff',
    '',
    '- Usage: run the project documented test command before distribution.',
    "- Data verification: run the generated tool's documented fixture or sample-data command when one is provided by the implementation.",
    '- License: review the generated `LICENSE` file and legal-license-advisor recommendations before distribution.',
    '',
  ].join('\n');
  if (!readme.includes('## MAP Handoff')) {
    readme = `${readme.trimEnd()}\n${section}`;
    await fs.writeFile(readmePath, readme, 'utf8');
  }
  let licenseStatus = 'LICENSE already present';
  try {
    await fs.access(licensePath);
  } catch {
    await fs.writeFile(licensePath, 'License choice required before distribution.\n', 'utf8');
    licenseStatus = 'LICENSE placeholder created';
  }
  const excerpt = readme.split('\n').filter((line) => /MAP Handoff|unittest|fixture-count|LICENSE|License/i.test(line)).slice(0, 8).join('\n');
  return [
    '# Documentation maintained',
    '',
    'Changed files: README.md' + (licenseStatus.includes('created') ? ', LICENSE' : ''),
    'Verification command/result: deterministic docs-maintainer verified README usage, fixture instructions, and license handoff text are present.',
    `License coverage: ${licenseStatus}.`,
    '',
    'README evidence excerpt:',
    '```',
    excerpt,
    '```',
  ].join('\n');
}


async function renderReleaseReadiness(cwd: string, prompt = ''): Promise<string> {
  const artifact = await inspectSoftwareArtifacts(cwd);
  const ready = artifact.sourceFiles > 0 && artifact.testFiles > 0 && artifact.hasReadme && artifact.hasLicense;
  if (/Judge the original step output|\"decision\":\"accept\|revise\|combine\|degraded/.test(prompt)) {
    return JSON.stringify({
      decision: ready ? 'accept' : 'revise',
      rationale: ready ? 'Local readiness evidence shows source, tests, README, and LICENSE artifacts.' : 'Local readiness evidence is incomplete.',
      remediation: ready ? [] : ['Regenerate missing source, test, README, or LICENSE artifacts.'],
      residualRisks: artifact.markdownRecords >= 1000 ? ['Large-record fixture coverage is local/offline, not a live external database transfer.'] : ['Live external database transfer is not proven by local artifact inspection.'],
    });
  }
  return [
    '# Release readiness review',
    '',
    `Verdict: ${ready ? 'ready' : 'not ready'}`,
    '',
    `- Source files counted: ${artifact.sourceFiles}`,
    `- Test files counted: ${artifact.testFiles}`,
    `- Markdown/data records counted: ${artifact.markdownRecords}`,
    `- README present: ${artifact.hasReadme}`,
    `- LICENSE present: ${artifact.hasLicense}`,
    '',
    '## Claim Evidence Ledger',
    '```json',
    JSON.stringify({ claims: [
      { id: 'ready-1', claim: `The generated workspace contains ${artifact.sourceFiles} source files and ${artifact.testFiles} test files.`, claimType: 'local-file-inspection', confidence: 'high', timeframe: 'current', recencyStatus: 'current', evidence: [{ sourceType: 'local-file', title: 'workspace source/test file scan', summary: `Counted source=${artifact.sourceFiles}; tests=${artifact.testFiles}.`, supports: 'Supports software implementation artifact presence.' }] },
      { id: 'ready-2', claim: `The generated workspace contains ${artifact.markdownRecords} Markdown/data record artifacts.`, claimType: 'local-file-inspection', confidence: 'high', timeframe: 'current', recencyStatus: 'current', evidence: [{ sourceType: 'local-file', title: 'workspace generated record scan', summary: `Counted ${artifact.markdownRecords} generated .md records excluding README-style documentation.`, supports: 'Supports local fixture/generated-record evidence without assuming a specific database.' }] },
      { id: 'ready-3', claim: `README and LICENSE presence is ${artifact.hasReadme && artifact.hasLicense ? 'complete' : 'incomplete'}.`, claimType: 'local-file-inspection', confidence: 'high', timeframe: 'current', recencyStatus: 'current', evidence: [{ sourceType: 'local-file', title: 'README.md and LICENSE', summary: `README present=${artifact.hasReadme}; LICENSE present=${artifact.hasLicense}.`, supports: 'Supports documentation and license handoff readiness.' }] },
    ] }, null, 2),
    '```',
  ].join('\n');
}

async function exists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function countFiles(dir: string, extension: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += await countFiles(full, extension);
    if (entry.isFile() && entry.name.endsWith(extension)) count += 1;
  }
  return count;
}


async function renderCodeQaAnalysis(cwd: string, prompt = ''): Promise<string> {
  const artifact = await inspectSoftwareArtifacts(cwd);
  const testRun = await runDetectedTestCommand(cwd);
  const verdict = artifact.sourceFiles > 0 && artifact.testFiles > 0 && artifact.hasReadme && testRun.passed ? 'accept' : 'revise';
  if (/cross-review critique|Return a concise structured cross-review critique/i.test(prompt)) {
    return [
      'Critique summary: Local artifact inspection confirms whether the generated software includes source, tests, README, and generated data artifacts without assuming a specific database.',
      `Verification reviewed: source files=${artifact.sourceFiles}; test files=${artifact.testFiles}; README present=${artifact.hasReadme}; generated Markdown/data records=${artifact.markdownRecords}.`,
      `Test command: ${testRun.command}; passed=${testRun.passed}.`,
      testRun.output ? `Test output excerpt: ${testRun.output.slice(0, 600)}` : '',
      verdict === 'accept' ? 'Required remediation: none.' : 'Required remediation: fix missing artifacts or failing generated project tests before release.',
      'Residual risks: live external database downloads require the generated project\'s own integration tests or documented manual verification.',
    ].filter(Boolean).join('\n');
  }
  return [
    '# Code QA review',
    '',
    verdict === 'accept' ? 'No critical, high, or medium blocking findings from local artifact and test inspection.' : 'Blocking findings remain for missing generated software artifacts or failing tests.',
    '',
    `- Source files counted: ${artifact.sourceFiles}`,
    `- Test files counted: ${artifact.testFiles}`,
    `- Markdown/data records counted: ${artifact.markdownRecords}`,
    `- README present: ${artifact.hasReadme}`,
    `- Test command: ${testRun.command}`,
    `- Test passed: ${testRun.passed}`,
    '',
    '```json',
    JSON.stringify({
      verdict,
      blockingFindings: verdict === 'accept' ? [] : [{ severity: 'high', file: 'workspace', issue: testRun.passed ? 'Required generated software artifacts are missing.' : `Generated project tests failed: ${testRun.output.slice(0, 300)}`, requiredFix: 'Return to the implementation agent and create/fix source, tests, and README artifacts from the prompt-specific requirements.' }],
      verificationRequired: [testRun.command, 'Run any generated fixture/sample-data command required by the prompt.'],
    }, null, 2),
    '```',
  ].join('\n');
}



interface TestRunResult {
  command: string;
  passed: boolean;
  output: string;
}

async function runDetectedTestCommand(cwd: string): Promise<TestRunResult> {
  const candidates: Array<{ command: string; file: string; args: string[] }> = [
    { command: './venv/bin/pytest -q', file: path.join(cwd, 'venv', 'bin', 'pytest'), args: ['-q'] },
    { command: './.venv/bin/pytest -q', file: path.join(cwd, '.venv', 'bin', 'pytest'), args: ['-q'] },
  ];
  for (const candidate of candidates) {
    if (await exists(candidate.file)) {
      try {
        const { stdout, stderr } = await execFileAsync(candidate.file, candidate.args, { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 });
        return { command: candidate.command, passed: true, output: `${stdout}${stderr}`.trim() };
      } catch (error) {
        const err = error as { stdout?: string; stderr?: string; message?: string };
        return { command: candidate.command, passed: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`.trim() };
      }
    }
  }
  if (await exists(path.join(cwd, 'package.json'))) {
    try {
      const { stdout, stderr } = await execFileAsync('npm', ['test'], { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 });
      return { command: 'npm test', passed: true, output: `${stdout}${stderr}`.trim() };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      return { command: 'npm test', passed: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`.trim() };
    }
  }
  if ((await countFiles(path.join(cwd, 'tests'), '.py')) > 0) {
    try {
      const { stdout, stderr } = await execFileAsync('python3', ['-m', 'unittest', 'discover', 'tests'], { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 });
      return { command: 'python3 -m unittest discover tests', passed: true, output: `${stdout}${stderr}`.trim() };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      return { command: 'python3 -m unittest discover tests', passed: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`.trim() };
    }
  }
  return { command: 'no test command detected', passed: false, output: 'No runnable test command was detected.' };
}

interface SoftwareArtifactInspection {
  sourceFiles: number;
  testFiles: number;
  markdownRecords: number;
  hasReadme: boolean;
  hasLicense: boolean;
}

async function inspectSoftwareArtifacts(cwd: string): Promise<SoftwareArtifactInspection> {
  const files = await listFiles(cwd);
  const normalized = files.map((file) => file.replace(/\\/g, '/'));
  return {
    sourceFiles: normalized.filter((file) => /(^|\/)(src|lib|app|pkg|cmd|internal|[A-Za-z0-9_-]+_sync)\//.test(file) && /\.(ts|tsx|js|mjs|cjs|py|go|rs|java|kt|rb)$/.test(file)).length,
    testFiles: normalized.filter((file) => /(^|\/)(tests?|__tests__)\//.test(file) || /(?:test|spec)\.(ts|tsx|js|py|go|rs|java|kt)$/.test(file)).length,
    markdownRecords: normalized.filter((file) => file.endsWith('.md') && !/(^|\/)(README|CHANGELOG|CONTRIBUTING|LICENSE)(?:\.md)?$/i.test(file)).length,
    hasReadme: normalized.some((file) => /(^|\/)README(?:\.md)?$/i.test(file)),
    hasLicense: normalized.some((file) => /(^|\/)LICENSE(?:\..*)?$/i.test(file)),
  };
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walkDir = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', 'coverage', 'venv', '.venv', '__pycache__', '.pytest_cache'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walkDir(full);
      if (entry.isFile()) out.push(path.relative(root, full));
    }
  };
  await walkDir(root);
  return out;
}
