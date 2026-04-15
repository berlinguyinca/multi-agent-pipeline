import blessed from 'neo-blessed';
import { marked } from 'marked';
import type { Token } from 'marked';
import { fgTag, getTheme } from './theme.js';
import { normalizeTerminalText } from '../utils/terminal-text.js';

export function renderModelOutput(content: string): string {
  const normalized = normalizeTerminalText(content).replace(/\r\n/g, '\n');
  const trimmed = normalized.trim();

  if (trimmed.length === 0) {
    return '';
  }

  if (looksLikeMarkdown(trimmed)) {
    const fencedJson = renderFencedJsonOutput(trimmed);
    if (fencedJson) {
      return fencedJson;
    }

    return renderMarkdownOutput(normalized);
  }

  const json = renderJsonOutput(trimmed);
  if (json) {
    return json;
  }

  return blessed.escape(normalized);
}

function renderJsonOutput(text: string): string | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate);
    return blessed.escape(JSON.stringify(parsed, null, 2));
  } catch {
    return null;
  }
}

function renderFencedJsonOutput(text: string): string | null {
  const unwrapped = stripMarkdownFences(text).trim();
  if (unwrapped === text.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(unwrapped);
    return blessed.escape(JSON.stringify(parsed, null, 2));
  } catch {
    return null;
  }
}

function extractJsonCandidate(text: string): string | null {
  const unwrapped = stripMarkdownFences(text).trim();
  if (!unwrapped) {
    return null;
  }

  try {
    JSON.parse(unwrapped);
    return unwrapped;
  } catch {
    // Fall back to balanced-object extraction below.
  }

  for (let index = 0; index < unwrapped.length; index += 1) {
    const char = unwrapped[index];
    if (char !== '{' && char !== '[') {
      continue;
    }

    const candidate = sliceBalancedJson(unwrapped, index);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function stripMarkdownFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  return match ? match[1].trim() : text;
}

function sliceBalancedJson(text: string, startIndex: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
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

    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }

    if (char === '}' || char === ']') {
      const open = stack.pop();
      if (!open || !matchesJsonPair(open, char)) {
        return null;
      }

      if (stack.length === 0) {
        return text.slice(startIndex, index + 1).trim();
      }
    }
  }

  return null;
}

function matchesJsonPair(open: string, close: string): boolean {
  return (open === '{' && close === '}') || (open === '[' && close === ']');
}

function looksLikeMarkdown(text: string): boolean {
  return (
    /(^|\n)#{1,6}\s+\S/m.test(text) ||
    /(^|\n)(?:-|\*|\+)\s+\S/m.test(text) ||
    /(^|\n)\d+\.\s+\S/m.test(text) ||
    /(^|\n)>\s+\S/m.test(text) ||
    /```/.test(text) ||
    /\[[^\]]+\]\([^)]+\)/.test(text) ||
    /\*\*[^*]+\*\*/.test(text) ||
    /__[^_]+__/.test(text) ||
    /`[^`]+`/.test(text) ||
    /(^|\n)\|.+\|/m.test(text)
  );
}

function renderMarkdownOutput(text: string): string {
  const tokens = marked.lexer(text) as Token[];
  return tokens
    .map((token) => renderBlockToken(token))
    .filter((block) => block.length > 0)
    .join('\n\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

function renderBlockToken(token: Token): string {
  const theme = getTheme();
  const block = token as Record<string, unknown> & Token;

  switch (block.type) {
    case 'heading': {
      const heading = renderInlineTokens((block as { tokens?: Token[] }).tokens ?? []);
      return `${fgTag(theme.colors.accent)}{bold}${heading}{/}`;
    }
    case 'paragraph':
      return renderInlineTokens((block as { tokens?: Token[] }).tokens ?? []);
    case 'text':
      return renderInlineTokens((block as { tokens?: Token[] }).tokens ?? []);
    case 'list':
      return renderList(block as unknown as MarkdownListToken);
    case 'blockquote':
      return renderBlockquote(block as unknown as MarkdownBlockquoteToken);
    case 'code':
      return renderCodeBlock(block as unknown as MarkdownCodeToken);
    case 'table':
      return renderTable(block as unknown as MarkdownTableToken);
    case 'hr':
      return `${fgTag(theme.colors.mutedSoft)}${'─'.repeat(24)}{/}`;
    case 'space':
      return '';
    default:
      if (Array.isArray((block as { tokens?: Token[] }).tokens)) {
        return renderInlineTokens((block as { tokens?: Token[] }).tokens ?? []);
      }

      if (typeof (block as { text?: string }).text === 'string') {
        return blessed.escape((block as { text: string }).text);
      }

      return '';
  }
}

function renderList(list: MarkdownListToken): string {
  const start = typeof list.start === 'number' ? list.start : 1;
  return list.items
    .map((item, index) => renderListItem(item, list.ordered, start + index))
    .join('\n');
}

function renderListItem(item: MarkdownListItemToken, ordered: boolean, index: number): string {
  const theme = getTheme();
  const prefixText = ordered ? `${index}. ` : '• ';
  const bullet = ordered
    ? `${fgTag(theme.colors.muted)}${prefixText}{/}`
    : `${fgTag(theme.colors.muted)}•{/} `;

  const rendered = renderTokenSequence(item.tokens ?? []);
  if (!rendered) {
    return bullet.trimEnd();
  }

  const lines = rendered.split('\n');
  const indent = ' '.repeat(prefixText.length);
  const firstLine = lines[0] ?? '';
  const remainingLines = lines.slice(1).map((line) => `${indent}${line}`);
  const taskPrefix = renderTaskPrefix(item);

  return `${bullet}${taskPrefix}${firstLine}${remainingLines.length > 0 ? `\n${remainingLines.join('\n')}` : ''}`;
}

function renderTaskPrefix(item: MarkdownListItemToken): string {
  if (!item.task) {
    return '';
  }

  const theme = getTheme();
  if (item.checked) {
    return `${fgTag(theme.colors.success)}☑{/} `;
  }

  return '☐ ';
}

function renderBlockquote(blockquote: MarkdownBlockquoteToken): string {
  const rendered = renderTokenSequence(blockquote.tokens ?? []);
  if (!rendered) {
    return '';
  }

  const theme = getTheme();
  return rendered
    .split('\n')
    .map((line) => (line.length > 0 ? `${fgTag(theme.colors.mutedSoft)}│{/} ${line}` : ''))
    .join('\n');
}

function renderCodeBlock(code: MarkdownCodeToken): string {
  const theme = getTheme();
  const language = code.lang ? ` ${code.lang}` : '';
  const fence = `${fgTag(theme.colors.muted)}\`\`\`${blessed.escape(language)}{/}`;
  const body = code.text
    .split('\n')
    .map((line) => `${fgTag(theme.colors.mutedSoft)}  ${blessed.escape(line)}{/}`)
    .join('\n');

  return [fence, body, fence].filter(Boolean).join('\n');
}

function renderTable(table: MarkdownTableToken): string {
  const theme = getTheme();
  const header = table.header.map((cell) => renderInlineTokens(cell.tokens)).join(' | ');
  const separator = table.header
    .map((cell) => '─'.repeat(Math.max(3, renderInlineTokens(cell.tokens).length)))
    .join('-+-');
  const rows = table.rows.map((row) => row.map((cell) => renderInlineTokens(cell.tokens)).join(' | '));

  return [
    `${fgTag(theme.colors.accent)}{bold}${header}{/}`,
    `${fgTag(theme.colors.mutedSoft)}${separator}{/}`,
    ...rows.map((row) => blessed.escape(row)),
  ].join('\n');
}

function renderTokenSequence(tokens: Token[]): string {
  return tokens.map((token) => renderInlineToken(token)).join('');
}

function renderInlineTokens(tokens: Token[]): string {
  return tokens.map((token) => renderInlineToken(token)).join('');
}

function renderInlineToken(token: Token): string {
  const inline = token as Record<string, unknown> & Token;

  switch (inline.type) {
    case 'text':
      return blessed.escape(String((inline as { text?: string }).text ?? ''));
    case 'strong':
      return `{bold}${renderInlineTokens((inline as { tokens?: Token[] }).tokens ?? [])}{/bold}`;
    case 'em':
      return `{underline}${renderInlineTokens((inline as { tokens?: Token[] }).tokens ?? [])}{/underline}`;
    case 'codespan':
      return `{inverse}${blessed.escape(String((inline as { text?: string }).text ?? ''))}{/inverse}`;
    case 'link': {
      const theme = getTheme();
      const label = renderInlineTokens((inline as { tokens?: Token[] }).tokens ?? []);
      const href = blessed.escape(String((inline as { href?: string }).href ?? ''));
      return `${fgTag(theme.colors.accent)}${label}{/}${fgTag(theme.colors.mutedSoft)} (${href}){/}`;
    }
    case 'br':
      return '\n';
    case 'del':
      return blessed.escape(renderInlineTokens((inline as { tokens?: Token[] }).tokens ?? []));
    case 'image': {
      const alt = blessed.escape(String((inline as { text?: string }).text ?? 'image'));
      const href = blessed.escape(String((inline as { href?: string }).href ?? ''));
      return `${alt} (${href})`;
    }
    default:
      if (Array.isArray((inline as { tokens?: Token[] }).tokens)) {
        return renderInlineTokens((inline as { tokens?: Token[] }).tokens ?? []);
      }

      if (typeof (inline as { text?: string }).text === 'string') {
        return blessed.escape((inline as { text: string }).text);
      }

      return '';
  }
}

interface MarkdownListToken {
  type: 'list';
  ordered: boolean;
  start?: number;
  items: MarkdownListItemToken[];
}

interface MarkdownListItemToken {
  task?: boolean;
  checked?: boolean;
  tokens?: Token[];
}

interface MarkdownBlockquoteToken {
  type: 'blockquote';
  tokens?: Token[];
}

interface MarkdownCodeToken {
  type: 'code';
  lang?: string;
  text: string;
}

interface MarkdownTableToken {
  type: 'table';
  header: Array<{ tokens: Token[] }>;
  rows: Array<Array<{ tokens: Token[] }>>;
}
