import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface PromptHistoryEntry {
  prompt: string;
  githubIssueUrl?: string;
  timestamp: string;
}

const HISTORY_FILE = path.join('.map', 'prompt-history.json');
const MAX_PROMPT_HISTORY = 20;

export function buildPromptHistoryPath(cwd: string): string {
  return path.join(cwd, HISTORY_FILE);
}

export async function loadPromptHistory(cwd: string): Promise<PromptHistoryEntry[]> {
  const filePath = buildPromptHistoryPath(cwd);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => normalizeEntry(entry))
      .filter((entry): entry is PromptHistoryEntry => entry !== null)
      .slice(0, MAX_PROMPT_HISTORY);
  } catch {
    return [];
  }
}

export async function recordPromptHistory(
  cwd: string,
  entry: Omit<PromptHistoryEntry, 'timestamp'> & { timestamp?: string | Date },
): Promise<PromptHistoryEntry[]> {
  const history = await loadPromptHistory(cwd);
  const normalized: PromptHistoryEntry = {
    prompt: entry.prompt.trim(),
    githubIssueUrl: normalizeOptionalString(entry.githubIssueUrl),
    timestamp:
      typeof entry.timestamp === 'string'
        ? entry.timestamp
        : entry.timestamp instanceof Date
          ? entry.timestamp.toISOString()
          : new Date().toISOString(),
  };

  if (!normalized.prompt && !normalized.githubIssueUrl) {
    return history;
  }

  const deduped = history.filter(
    (item) =>
      item.prompt.trim() !== normalized.prompt ||
      normalizeOptionalString(item.githubIssueUrl) !== normalized.githubIssueUrl,
  );

  deduped.unshift(normalized);

  const trimmed = deduped.slice(0, MAX_PROMPT_HISTORY);
  await fs.mkdir(path.dirname(buildPromptHistoryPath(cwd)), { recursive: true });
  await fs.writeFile(buildPromptHistoryPath(cwd), `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  return trimmed;
}

function normalizeEntry(entry: unknown): PromptHistoryEntry | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }

  const value = entry as Record<string, unknown>;
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  if (!prompt && typeof value.githubIssueUrl !== 'string') {
    return null;
  }

  return {
    prompt,
    githubIssueUrl: normalizeOptionalString(value.githubIssueUrl),
    timestamp:
      typeof value.timestamp === 'string' && value.timestamp.trim() !== ''
        ? value.timestamp
        : new Date().toISOString(),
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
