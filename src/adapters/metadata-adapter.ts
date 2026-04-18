import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AdapterType, DetectInfo, RunOptions } from '../types/adapter.js';

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

  async *run(_prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
    this.cancelled = false;
    const cwd = path.resolve(options?.cwd ?? process.cwd());
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
