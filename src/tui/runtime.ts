import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DetectionResult, AdapterConfig, AdapterType } from '../types/adapter.js';
import type { AgentAssignment, StageName } from '../types/config.js';
import type {
  ExecutionResult,
  DocumentationResult,
  QaAssessment,
  RefinementScore,
  ReviewAnnotation,
  ReviewedSpec,
} from '../types/spec.js';
import type { PipelineContext } from '../types/pipeline.js';
import { AdapterNotFoundError } from '../utils/error.js';
import { buildSpecPrompt } from '../prompts/spec-system.js';
import { buildFeedbackPrompt } from '../prompts/feedback-system.js';
import { buildReviewPrompt } from '../prompts/review-system.js';
import { buildExecutePrompt } from '../prompts/execute-system.js';

export interface TestProgressItem {
  name: string;
  status: 'writing' | 'passing' | 'failing';
}

export interface DocumentationBaseline {
  files: Record<string, string>;
}

const REVIEW_SCORE_REGEX =
  /SCORES:\s*completeness=(\d(?:\.\d+)?)\s+testability=(\d(?:\.\d+)?)\s+specificity=(\d(?:\.\d+)?)/i;
const TEST_MARKER_REGEX = /\[TEST:(WRITE|PASS|FAIL)\]\s*(.+)$/gm;
const QA_RESULT_REGEX = /^QA_RESULT:\s*(pass|fail)\s*$/im;
const QA_SUMMARY_REGEX = /^SUMMARY:\s*(.+)$/im;
const QA_FINDING_REGEX = /^FINDING:\s*(.+)$/gim;
const QA_REQUIRED_CHANGE_REGEX = /^REQUIRED_CHANGE:\s*(.+)$/gim;
const IGNORED_EXECUTION_DIRS = new Set(['.git', 'node_modules']);
const IGNORED_SNAPSHOT_DIRS = new Set(['.git', 'node_modules', 'dist', '.codesight']);
const IGNORED_SNAPSHOT_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);
const DEFAULT_SNAPSHOT_MAX_BYTES = 120_000;

export function assignmentToAdapterConfig(
  assignment: AgentAssignment,
  ollamaHost?: string,
): AdapterConfig {
  if (assignment.adapter === 'ollama') {
    return { type: 'ollama', model: assignment.model, host: ollamaHost };
  }

  return { type: assignment.adapter };
}

export function assertAdapterInstalled(
  assignment: AgentAssignment,
  detection: DetectionResult,
): void {
  const info = detection[assignment.adapter];
  if (info.installed) {
    return;
  }

  throw new AdapterNotFoundError(assignment.adapter, binaryNameForAdapter(assignment.adapter));
}

export interface BuildStagePromptOptions {
  stage: StageName;
  context: PipelineContext;
  latestSpecContent: string;
  latestReviewedSpecContent: string;
  personality?: string;
}

export function buildStagePrompt({
  stage,
  context,
  latestSpecContent,
  latestReviewedSpecContent,
  personality,
}: BuildStagePromptOptions): string {
  let prompt: string;
  const sourceRequest = context.initialSpec ?? context.prompt;

  if (stage === 'spec') {
    const feedbackText = context.feedbackHistory.at(-1);
    if (feedbackText && latestSpecContent !== '' && latestReviewedSpecContent !== '') {
      prompt = buildFeedbackPrompt(
        sourceRequest,
        latestSpecContent,
        latestReviewedSpecContent,
        feedbackText,
      );
    } else {
      prompt = buildSpecPrompt(sourceRequest);
    }
  } else if (stage === 'review') {
    prompt = buildReviewPrompt(latestSpecContent);
  } else if (stage === 'execute') {
    prompt = `${buildExecutePrompt(latestReviewedSpecContent)}

Create the project in the current working directory. Do not write files outside that directory.`;
  } else {
    throw new Error(`Unsupported generic stage prompt: ${stage}`);
  }

  if (personality) {
    prompt = `[PERSONALITY DIRECTIVE]\n${personality}\n[END PERSONALITY DIRECTIVE]\n\n${prompt}`;
  }

  return prompt;
}

export function parseReviewOutput(
  output: string,
  iteration: number,
  originalSpecVersion: number,
): { reviewedSpec: ReviewedSpec; score: RefinementScore } {
  const normalized = output.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');
  const annotations: ReviewAnnotation[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('IMPROVEMENT:')) {
      annotations.push({ type: 'improvement', text: trimmed.slice('IMPROVEMENT:'.length).trim() });
    } else if (trimmed.startsWith('WARNING:')) {
      annotations.push({ type: 'warning', text: trimmed.slice('WARNING:'.length).trim() });
    } else if (trimmed.startsWith('APPROVAL:')) {
      annotations.push({ type: 'approval', text: trimmed.slice('APPROVAL:'.length).trim() });
    }
  }

  const scoreMatch = normalized.match(REVIEW_SCORE_REGEX);
  const completeness = parseScoreComponent(scoreMatch?.[1]);
  const testability = parseScoreComponent(scoreMatch?.[2]);
  const specificity = parseScoreComponent(scoreMatch?.[3]);
  const score = Math.round(((completeness + testability + specificity) / 3) * 100);

  const specContent = extractReviewedSpec(lines);

  return {
    reviewedSpec: {
      content: specContent,
      version: iteration,
      annotations,
      originalSpecVersion,
    },
    score: {
      iteration,
      score,
      completeness,
      testability,
      specificity,
      timestamp: new Date(),
    },
  };
}

export function parseExecutionProgress(output: string): TestProgressItem[] {
  const tests = new Map<string, TestProgressItem>();
  const matches = output.matchAll(TEST_MARKER_REGEX);

  for (const match of matches) {
    const marker = match[1]?.toUpperCase();
    const name = match[2]?.trim();
    if (!marker || !name) {
      continue;
    }

    const existing = tests.get(name);
    const status =
      marker === 'WRITE' ? 'writing' : marker === 'PASS' ? 'passing' : 'failing';

    if (existing) {
      existing.status = status;
    } else {
      tests.set(name, { name, status });
    }
  }

  return [...tests.values()];
}

export function parseQaOutput(
  output: string,
  target: QaAssessment['target'],
  duration: number,
): QaAssessment {
  const normalized = output.replace(/\r\n/g, '\n').trim();
  const resultMatch = normalized.match(QA_RESULT_REGEX);
  const summaryMatch = normalized.match(QA_SUMMARY_REGEX);
  const findings = [...normalized.matchAll(QA_FINDING_REGEX)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const requiredChanges = [...normalized.matchAll(QA_REQUIRED_CHANGE_REGEX)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  if (!resultMatch) {
    return {
      passed: false,
      target,
      summary: 'QA output did not include a parseable QA_RESULT marker.',
      findings,
      requiredChanges:
        requiredChanges.length > 0
          ? requiredChanges
          : ['Return a QA_RESULT marker and address any visible QA findings.'],
      rawOutput: normalized,
      duration,
    };
  }

  return {
    passed: resultMatch[1]?.toLowerCase() === 'pass',
    target,
    summary: summaryMatch?.[1]?.trim() ?? '',
    findings,
    requiredChanges,
    rawOutput: normalized,
    duration,
  };
}

export async function finalizeExecutionResult(
  outputDir: string,
  output: string,
  duration: number,
): Promise<ExecutionResult> {
  const tests = parseExecutionProgress(output);
  const filesCreated = await listExecutionFiles(outputDir);
  const testsPassing = tests.filter((test) => test.status === 'passing').length;
  const testsFailing = tests.length - testsPassing;
  const success = tests.length === 0 ? filesCreated.length > 0 : testsFailing === 0;

  return {
    success,
    testsTotal: tests.length,
    testsPassing,
    testsFailing,
    filesCreated,
    outputDir,
    duration,
  };
}

export async function captureDocumentationBaseline(
  outputDir: string,
): Promise<DocumentationBaseline> {
  return { files: await hashFiles(outputDir) };
}

export async function finalizeDocumentationResult(
  outputDir: string,
  baseline: DocumentationBaseline,
  output: string,
  duration: number,
): Promise<DocumentationResult> {
  const after = await hashFiles(outputDir);
  const changedFiles = diffFileHashes(baseline.files, after);
  const nonMarkdownChanges = changedFiles.filter((file) => !isMarkdownFile(file));

  if (nonMarkdownChanges.length > 0) {
    throw new Error(
      `Documentation phase modified non-Markdown files: ${nonMarkdownChanges.join(', ')}`,
    );
  }

  return {
    filesUpdated: changedFiles.sort((a, b) => a.localeCompare(b)),
    outputDir,
    duration,
    rawOutput: output.trim(),
  };
}

export async function prepareExecutionOutputDir(
  baseOutputDir: string,
  prompt: string,
  pipelineId: string,
): Promise<string> {
  const baseDir = path.resolve(baseOutputDir);
  await fs.mkdir(baseDir, { recursive: true });

  const slug = slugify(prompt);
  const preferredDir = path.join(baseDir, slug);
  if (!(await directoryHasFiles(preferredDir))) {
    await fs.mkdir(preferredDir, { recursive: true });
    return preferredDir;
  }

  const fallbackDir = path.join(baseDir, `${slug}-${pipelineId.slice(0, 8)}`);
  await fs.mkdir(fallbackDir, { recursive: true });
  return fallbackDir;
}

export async function prepareStageWorkspace(
  pipelineId: string,
  stage: 'spec' | 'review' | 'qa',
  iteration: number,
): Promise<string> {
  const dir = path.join(os.tmpdir(), 'map-stage-workspaces', pipelineId, `iter-${iteration}`, stage);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function collectProjectSnapshot(
  rootDir: string,
  maxBytes = DEFAULT_SNAPSHOT_MAX_BYTES,
): Promise<string> {
  const files = await listSnapshotFiles(rootDir, rootDir);
  const chunks: string[] = [];
  let remaining = maxBytes;

  for (const file of files) {
    if (remaining <= 0) {
      chunks.push('\n[Snapshot truncated]\n');
      break;
    }

    const fullPath = path.join(rootDir, file);
    const content = await fs.readFile(fullPath);
    if (content.includes(0)) {
      continue;
    }

    const text = content.toString('utf8');
    const header = `\n--- ${file} ---\n`;
    const available = remaining - Buffer.byteLength(header);
    if (available <= 0) {
      break;
    }

    const encoded = Buffer.from(text);
    const body =
      encoded.byteLength > available
        ? encoded.subarray(0, available).toString('utf8')
        : text;

    chunks.push(header, body);
    remaining -= Buffer.byteLength(header) + Buffer.byteLength(body);
  }

  return chunks.join('').trim() || '(no readable project files)';
}

function binaryNameForAdapter(adapter: AdapterType): string {
  switch (adapter) {
    case 'claude':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'ollama':
      return 'ollama';
    case 'hermes':
      return 'hermes';
  }
}

function parseScoreComponent(raw: string | undefined): number {
  const parsed = Number.parseFloat(raw ?? '');
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
    return parsed;
  }

  return 0.5;
}

function extractReviewedSpec(lines: string[]): string {
  const filteredLines = lines.filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed !== '' &&
      !trimmed.startsWith('IMPROVEMENT:') &&
      !trimmed.startsWith('WARNING:') &&
      !trimmed.startsWith('APPROVAL:') &&
      !REVIEW_SCORE_REGEX.test(trimmed)
    );
  });

  const headingIndex = filteredLines.findIndex((line) => /^(#{1,6}\s|##\s*Goal\b)/.test(line.trim()));
  if (headingIndex !== -1) {
    return filteredLines.slice(headingIndex).join('\n').trim();
  }

  return filteredLines.join('\n').trim();
}

async function directoryHasFiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function listExecutionFiles(dir: string): Promise<string[]> {
  try {
    return await walkFiles(dir, dir);
  } catch {
    return [];
  }
}

async function hashFiles(dir: string): Promise<Record<string, string>> {
  const files = await listExecutionFiles(dir);
  const hashes: Record<string, string> = {};

  for (const file of files) {
    const content = await fs.readFile(path.join(dir, file));
    hashes[file] = createHash('sha256').update(content).digest('hex');
  }

  return hashes;
}

function diffFileHashes(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  const files = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...files].filter((file) => before[file] !== after[file]);
}

function isMarkdownFile(file: string): boolean {
  return path.extname(file).toLowerCase() === '.md';
}

async function walkFiles(dir: string, root: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (IGNORED_EXECUTION_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath, root)));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.relative(root, fullPath));
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function listSnapshotFiles(dir: string, root: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_SNAPSHOT_DIRS.has(entry.name)) {
      continue;
    }

    if (entry.isFile() && IGNORED_SNAPSHOT_FILES.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSnapshotFiles(fullPath, root)));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.relative(root, fullPath));
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || 'project';
}
