import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type KnowledgeScope = 'global' | 'local';
export type KnowledgeFreshnessClass = 'fast' | 'medium' | 'slow' | 'evergreen';
export type KnowledgeState = 'fresh' | 'aging' | 'stale' | 'expired';

export interface KnowledgeEntry {
  id: string;
  title: string;
  scope: KnowledgeScope;
  path: string;
  category: string;
  freshnessClass: KnowledgeFreshnessClass;
  ttlDays: number | null;
  updatedAt: string;
  expiresAt: string | null;
  state: KnowledgeState;
  snippet: string;
}

export interface KnowledgeIndex {
  generatedAt: string;
  entries: KnowledgeEntry[];
}

export interface BuildKnowledgeIndexOptions {
  cwd: string;
  globalRoot?: string;
}

export interface QueryKnowledgeOptions {
  cwd: string;
  query: string;
  limit?: number;
  globalRoot?: string;
}

export interface KnowledgeQueryResult extends KnowledgeEntry {
  score: number;
  content: string;
}

export interface RecordLearningCandidateOptions {
  cwd: string;
  title: string;
  lesson: string;
  sourceTask: string;
  confidence: 'low' | 'medium' | 'high';
  freshnessHint?: KnowledgeFreshnessClass;
}

export interface CanonicalizeLearningCandidatesOptions {
  cwd: string;
}

const LOCAL_BRAIN_ROOT = path.join('.map', 'brain', 'local');
const LOCAL_INDEX_PATH = path.join('.map', 'brain', 'index.json');

export async function buildKnowledgeIndex(
  options: BuildKnowledgeIndexOptions,
): Promise<KnowledgeIndex> {
  const localRoot = path.join(options.cwd, LOCAL_BRAIN_ROOT);
  const globalRoot = options.globalRoot ?? defaultGlobalKnowledgeRoot();
  await fs.mkdir(localRoot, { recursive: true });
  await fs.mkdir(globalRoot, { recursive: true });

  const entries = [
    ...(await scanKnowledgeRoot(localRoot, 'local')),
    ...(await scanKnowledgeRoot(globalRoot, 'global')),
  ].sort((a, b) => a.title.localeCompare(b.title));

  const index: KnowledgeIndex = {
    generatedAt: new Date().toISOString(),
    entries,
  };

  const indexPath = path.join(options.cwd, LOCAL_INDEX_PATH);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return index;
}

export async function queryKnowledge(
  options: QueryKnowledgeOptions,
): Promise<KnowledgeQueryResult[]> {
  const index = await ensureKnowledgeIndex({
    cwd: options.cwd,
    globalRoot: options.globalRoot,
  });
  const terms = normalizeTerms(options.query);
  const limit = Math.max(1, Math.min(options.limit ?? 5, 10));

  const scored = await Promise.all(
    index.entries.map(async (entry) => {
      const content = await fs.readFile(entry.path, 'utf8');
      const haystack = `${entry.title}\n${entry.snippet}\n${content}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return {
        ...entry,
        score,
        content: entry.snippet.length > 280 ? entry.snippet.slice(0, 277) + '...' : entry.snippet,
      };
    }),
  );

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export async function recordLearningCandidate(
  options: RecordLearningCandidateOptions,
): Promise<string> {
  const candidateDir = path.join(options.cwd, LOCAL_BRAIN_ROOT, 'candidates');
  await fs.mkdir(candidateDir, { recursive: true });
  const fileName = `${Date.now()}-${slugify(options.title)}.md`;
  const filePath = path.join(candidateDir, fileName);
  const content = [
    `# ${options.title}`,
    '',
    `source_task: ${options.sourceTask}`,
    `confidence: ${options.confidence}`,
    `freshness: ${options.freshnessHint ?? 'medium'}`,
    '',
    options.lesson.trim(),
    '',
  ].join('\n');
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

export async function canonicalizeLearningCandidates(
  options: CanonicalizeLearningCandidatesOptions,
): Promise<string[]> {
  const candidateDir = path.join(options.cwd, LOCAL_BRAIN_ROOT, 'candidates');
  const lessonDir = path.join(options.cwd, LOCAL_BRAIN_ROOT, 'lessons');
  await fs.mkdir(candidateDir, { recursive: true });
  await fs.mkdir(lessonDir, { recursive: true });

  const entries = await fs.readdir(candidateDir);
  const promoted: string[] = [];

  for (const entry of entries) {
    const sourcePath = path.join(candidateDir, entry);
    const raw = await fs.readFile(sourcePath, 'utf8');
    const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'lesson';
    const lessonPath = path.join(lessonDir, `${slugify(title)}.md`);
    await fs.writeFile(lessonPath, raw, 'utf8');
    await fs.rm(sourcePath, { force: true });
    promoted.push(lessonPath);
  }

  await buildKnowledgeIndex({ cwd: options.cwd });
  return promoted;
}

export function defaultGlobalKnowledgeRoot(): string {
  return path.join(os.homedir(), '.map', 'brain', 'global');
}

async function ensureKnowledgeIndex(options: BuildKnowledgeIndexOptions): Promise<KnowledgeIndex> {
  const indexPath = path.join(options.cwd, LOCAL_INDEX_PATH);
  try {
    const content = await fs.readFile(indexPath, 'utf8');
    return JSON.parse(content) as KnowledgeIndex;
  } catch {
    return buildKnowledgeIndex(options);
  }
}

async function scanKnowledgeRoot(root: string, scope: KnowledgeScope): Promise<KnowledgeEntry[]> {
  const filePaths = await collectMarkdownFiles(root);
  const entries: KnowledgeEntry[] = [];

  for (const filePath of filePaths) {
    const raw = await fs.readFile(filePath, 'utf8');
    const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(filePath, '.md');
    const snippet = summarize(raw);
    const freshnessClass = inferFreshnessClass(filePath, raw);
    const ttlDays = ttlForFreshness(freshnessClass);
    const stat = await fs.stat(filePath);
    const updatedAt = stat.mtime.toISOString();
    const expiresAt =
      ttlDays === null ? null : new Date(stat.mtimeMs + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    entries.push({
      id: `${scope}:${path.relative(root, filePath)}`,
      title,
      scope,
      path: filePath,
      category: inferCategory(filePath, raw),
      freshnessClass,
      ttlDays,
      updatedAt,
      expiresAt,
      state: freshnessState(expiresAt),
      snippet,
    });
  }

  return entries;
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectMarkdownFiles(filePath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(filePath);
    }
  }
  return results;
}

function summarize(content: string): string {
  const normalized = content
    .replace(/^#.+$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 280 ? `${normalized.slice(0, 277)}...` : normalized;
}

function inferFreshnessClass(filePath: string, content: string): KnowledgeFreshnessClass {
  const haystack = `${filePath}\n${content}`.toLowerCase();
  if (/(woodwork|woodworking|mortise|tenon|craft|joinery)/.test(haystack)) {
    return 'evergreen';
  }
  if (/(ai|llm|model|prompt|gpt|claude|codex|ollama|day trading|market|finance|api|framework|library)/.test(haystack)) {
    return 'fast';
  }
  if (/(typescript|react|sql|database|migration|software)/.test(haystack)) {
    return 'medium';
  }
  return 'slow';
}

function inferCategory(filePath: string, content: string): string {
  const haystack = `${filePath}\n${content}`.toLowerCase();
  if (/(sql|database|migration|query)/.test(haystack)) return 'database';
  if (/(ux|design|web|interface)/.test(haystack)) return 'design';
  if (/(ai|llm|model|prompt)/.test(haystack)) return 'ai';
  if (/(finance|trading|market)/.test(haystack)) return 'finance';
  if (/(woodwork|woodworking|craft)/.test(haystack)) return 'craft';
  return 'general';
}

function ttlForFreshness(freshness: KnowledgeFreshnessClass): number | null {
  switch (freshness) {
    case 'fast':
      return 7;
    case 'medium':
      return 45;
    case 'slow':
      return 365;
    case 'evergreen':
      return null;
  }
}

function freshnessState(expiresAt: string | null): KnowledgeState {
  if (!expiresAt) return 'fresh';
  const now = Date.now();
  const expiry = new Date(expiresAt).getTime();
  const ageRatio = (expiry - now) / (24 * 60 * 60 * 1000);
  if (ageRatio <= 0) return 'expired';
  if (ageRatio <= 3) return 'stale';
  if (ageRatio <= 14) return 'aging';
  return 'fresh';
}

function normalizeTerms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((term) => term.trim())
    .filter(Boolean);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}
