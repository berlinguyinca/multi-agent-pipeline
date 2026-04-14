import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureDocumentationBaseline,
  finalizeDocumentationResult,
  finalizeExecutionResult,
  parseQaOutput,
  parseExecutionProgress,
  parseReviewOutput,
  prepareExecutionOutputDir,
  collectProjectSnapshot,
} from '../../src/tui/runtime.js';

describe('parseReviewOutput', () => {
  it('extracts annotations, scores, and reviewed spec content', () => {
    const output = `
IMPROVEMENT: Add input validation
WARNING: Authentication is underspecified
APPROVAL: Pagination requirements are clear

# Task API v2

## Goal
Build the API.

## Acceptance Criteria
- [ ] Create tasks

SCORES: completeness=0.9 testability=0.8 specificity=0.7
`.trim();

    const result = parseReviewOutput(output, 2, 1);

    expect(result.reviewedSpec.annotations).toEqual([
      { type: 'improvement', text: 'Add input validation' },
      { type: 'warning', text: 'Authentication is underspecified' },
      { type: 'approval', text: 'Pagination requirements are clear' },
    ]);
    expect(result.reviewedSpec.content).toContain('# Task API v2');
    expect(result.reviewedSpec.content).toContain('## Acceptance Criteria');
    expect(result.reviewedSpec.originalSpecVersion).toBe(1);
    expect(result.score.score).toBe(80);
    expect(result.score.completeness).toBe(0.9);
    expect(result.score.testability).toBe(0.8);
    expect(result.score.specificity).toBe(0.7);
  });
});

describe('parseExecutionProgress', () => {
  it('tracks the latest status for each test marker', () => {
    const output = `
// [TEST:WRITE] creates a task
// [TEST:WRITE] lists tasks
// [TEST:PASS] creates a task
// [TEST:FAIL] lists tasks
`.trim();

    expect(parseExecutionProgress(output)).toEqual([
      { name: 'creates a task', status: 'passing' },
      { name: 'lists tasks', status: 'failing' },
    ]);
  });
});

describe('parseQaOutput', () => {
  it('extracts pass/fail status, summary, findings, and required changes', () => {
    const assessment = parseQaOutput(
      `
QA_RESULT: fail
SUMMARY: Missing important behavior.
FINDING: No invalid input tests.
FINDING: README omits usage.
REQUIRED_CHANGE: Add invalid input coverage.
REQUIRED_CHANGE: Document commands.
`.trim(),
      'code',
      250,
    );

    expect(assessment.passed).toBe(false);
    expect(assessment.target).toBe('code');
    expect(assessment.summary).toBe('Missing important behavior.');
    expect(assessment.findings).toEqual(['No invalid input tests.', 'README omits usage.']);
    expect(assessment.requiredChanges).toEqual([
      'Add invalid input coverage.',
      'Document commands.',
    ]);
    expect(assessment.duration).toBe(250);
  });

  it('fails safely when QA_RESULT is missing', () => {
    const assessment = parseQaOutput('SUMMARY: unclear', 'spec', 100);

    expect(assessment.passed).toBe(false);
    expect(assessment.summary).toContain('QA_RESULT');
    expect(assessment.requiredChanges).toHaveLength(1);
  });
});

describe('prepareExecutionOutputDir', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('creates a prompt-based output directory and falls back when reused', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-runtime-'));
    tempDirs.push(baseDir);

    const firstDir = await prepareExecutionOutputDir(baseDir, 'Build Task API', 'pipe-12345678');
    expect(path.basename(firstDir)).toBe('build-task-api');

    await fs.writeFile(path.join(firstDir, 'package.json'), '{}', 'utf8');

    const secondDir = await prepareExecutionOutputDir(baseDir, 'Build Task API', 'pipe-12345678');
    expect(path.basename(secondDir)).toBe('build-task-api-pipe-123');
  });
});

describe('finalizeExecutionResult', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('summarizes generated files and test markers', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-exec-'));
    tempDirs.push(outputDir);

    await fs.mkdir(path.join(outputDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'src', 'index.ts'), 'export {};\n', 'utf8');
    await fs.writeFile(path.join(outputDir, 'package.json'), '{}', 'utf8');

    const result = await finalizeExecutionResult(
      outputDir,
      `
// [TEST:WRITE] creates a task
// [TEST:PASS] creates a task
`.trim(),
      1200,
    );

    expect(result.success).toBe(true);
    expect(result.testsTotal).toBe(1);
    expect(result.testsPassing).toBe(1);
    expect(result.testsFailing).toBe(0);
    expect(result.filesCreated).toEqual(['package.json', 'src/index.ts']);
    expect(result.duration).toBe(1200);
  });
});

describe('collectProjectSnapshot', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('collects source files while ignoring generated and dependency directories', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-snapshot-'));
    tempDirs.push(outputDir);

    await fs.mkdir(path.join(outputDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'node_modules', 'pkg'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'dist'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'src', 'index.ts'), 'export {};\n', 'utf8');
    await fs.writeFile(path.join(outputDir, 'dist', 'index.js'), 'ignored();\n', 'utf8');
    await fs.writeFile(path.join(outputDir, 'package-lock.json'), '{}\n', 'utf8');

    const snapshot = await collectProjectSnapshot(outputDir);

    expect(snapshot).toContain('--- src/index.ts ---');
    expect(snapshot).not.toContain('dist/index.js');
    expect(snapshot).not.toContain('package-lock.json');
    expect(snapshot).not.toContain('node_modules');
  });
});

describe('finalizeDocumentationResult', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('reports Markdown files changed during documentation', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-docs-'));
    tempDirs.push(outputDir);
    await fs.writeFile(path.join(outputDir, 'README.md'), '# Old\n', 'utf8');

    const baseline = await captureDocumentationBaseline(outputDir);
    await fs.writeFile(path.join(outputDir, 'README.md'), '# New\n', 'utf8');
    await fs.mkdir(path.join(outputDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'docs', 'usage.md'), '# Usage\n', 'utf8');

    const result = await finalizeDocumentationResult(outputDir, baseline, 'updated docs', 250);

    expect(result.filesUpdated).toEqual(expect.arrayContaining(['README.md', 'docs/usage.md']));
    expect(result.filesUpdated).toHaveLength(2);
    expect(result.duration).toBe(250);
    expect(result.rawOutput).toBe('updated docs');
  });

  it('rejects non-Markdown changes during documentation', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-docs-'));
    tempDirs.push(outputDir);
    await fs.writeFile(path.join(outputDir, 'README.md'), '# Old\n', 'utf8');

    const baseline = await captureDocumentationBaseline(outputDir);
    await fs.writeFile(path.join(outputDir, 'src.ts'), 'export {};\n', 'utf8');

    await expect(
      finalizeDocumentationResult(outputDir, baseline, 'changed source', 250),
    ).rejects.toThrow('non-Markdown');
  });
});
