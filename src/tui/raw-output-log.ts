import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { normalizeTerminalText } from '../utils/terminal-text.js';

const BOX_DRAWING_LINE = /^[\s│┃╭╮╰╯┌┐└┘├┤┬┴┼─━═]+$/;
const LEADING_FRAME = /^[\s]*[│┃┌┐└┘├┤┬┴┼╭╮╰╯]/;
const TRAILING_FRAME = /[│┃┌┐└┘├┤┬┴┼╭╮╰╯][\s]*$/;

export function formatRawOutputForStorage(text: string): string {
  const normalized = normalizeTerminalText(text).trim();
  const canonicalJson = extractCanonicalJsonPayload(normalized);
  if (canonicalJson) {
    return canonicalJson;
  }

  const lines = normalized
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (BOX_DRAWING_LINE.test(line)) {
        return '';
      }

      let cleaned = line;
      if (LEADING_FRAME.test(cleaned)) {
        cleaned = cleaned.replace(/^[\s]*[│┃┌┐└┘├┤┬┴┼╭╮╰╯][\s]?/, '');
      }
      if (TRAILING_FRAME.test(cleaned)) {
        cleaned = cleaned.replace(/[\s]?[│┃┌┐└┘├┤┬┴┼╭╮╰╯][\s]*$/, '');
      }

      return cleaned.replace(/\s+$/, '');
    })
    .filter((line) => line.length > 0);

  return lines.join('\n');
}

export function cleanRawOutputContent(text: string): string {
  return formatRawOutputForStorage(text);
}

function extractCanonicalJsonPayload(text: string): string | null {
  const searchSpace = stripMarkdownFences(text);
  const braceStarts: number[] = [];

  for (let start = searchSpace.indexOf('{'); start !== -1; start = searchSpace.indexOf('{', start + 1)) {
    braceStarts.push(start);
  }

  for (let i = braceStarts.length - 1; i >= 0; i -= 1) {
    const start = braceStarts[i]!;
    const candidate = sliceBalancedJson(searchSpace, start);
    if (candidate === null) continue;

    try {
      const parsed = JSON.parse(candidate);
      if (isRouterLikePayload(parsed)) {
        return `${JSON.stringify(parsed, null, 2)}\n`;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function stripMarkdownFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  return match ? match[1].trim() : text;
}

function sliceBalancedJson(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1).trim();
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}

function isRouterLikePayload(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    obj['kind'] === 'plan' ||
    obj['kind'] === 'no-match' ||
    Array.isArray(obj['plan']) ||
    typeof obj['reason'] === 'string'
  );
}

export function buildRawOutputLogPath(
  cwd: string,
  key: string,
  title: string,
  timestamp = new Date(),
): string {
  const logsDir = path.join(cwd, '.map', 'logs');
  const stamp = timestamp.toISOString().replace(/[:.]/g, '-');
  const safeKey = slugify(key);
  const safeTitle = slugify(title);
  const fileName = [stamp, safeKey, safeTitle].filter(Boolean).join('-') || stamp;
  return path.join(logsDir, `${fileName}.log`);
}

export async function persistRawOutputLog(
  cwd: string,
  key: string,
  title: string,
  content: string,
  timestamp = new Date(),
): Promise<string> {
  const logPath = buildRawOutputLogPath(cwd, key, title, timestamp);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, `${cleanRawOutputContent(content)}\n`, 'utf8');
  return logPath;
}

export function persistRawOutputLogSync(
  cwd: string,
  key: string,
  title: string,
  content: string,
  timestamp = new Date(),
): string {
  const logPath = buildRawOutputLogPath(cwd, key, title, timestamp);
  fsSync.mkdirSync(path.dirname(logPath), { recursive: true });
  fsSync.writeFileSync(logPath, `${cleanRawOutputContent(content)}\n`, 'utf8');
  return logPath;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
