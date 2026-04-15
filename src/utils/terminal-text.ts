const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_SINGLE_CHAR_PATTERN = /\u001b[@-Z\\-_]/g;

export function normalizeTerminalText(text: string): string {
  const withoutAnsi = text
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(ANSI_SINGLE_CHAR_PATTERN, '')
    .replace(/\u0007/g, '')
    .replace(/\u0008/g, '\b')
    .replace(/\u007f/g, '\b');

  let result = '';
  let line: string[] = [];
  let cursor = 0;

  function flushLine(keepNewline: boolean): void {
    result += line.join('');
    if (keepNewline) {
      result += '\n';
    }
    line = [];
    cursor = 0;
  }

  function writeChar(char: string): void {
    if (cursor < line.length) {
      line[cursor] = char;
    } else {
      line.push(char);
    }
    cursor += 1;
  }

  for (let index = 0; index < withoutAnsi.length; index += 1) {
    const char = withoutAnsi[index];

    if (char === '\b') {
      if (cursor > 0) {
        cursor -= 1;
        line.splice(cursor, 1);
      }
      continue;
    }

    if (char === '\r') {
      cursor = 0;
      continue;
    }

    if (char === '\n') {
      flushLine(true);
      continue;
    }

    if (char === '\t') {
      writeChar(' ');
      continue;
    }

    if (char < ' ') {
      continue;
    }

    writeChar(char);
  }

  return result + line.join('');
}

export function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  return `${text.slice(0, maxWidth - 1)}…`;
}

export function wrapText(text: string, width: number, indent = ''): string {
  if (width <= 0) {
    return text;
  }

  const normalized = normalizeTerminalText(text);
  const wrapped: string[] = [];
  const available = Math.max(1, width);

  for (const paragraph of normalized.split('\n')) {
    if (paragraph.trim() === '') {
      wrapped.push('');
      continue;
    }

    const leadingWhitespace = paragraph.match(/^\s*/)?.[0] ?? '';
    const baseIndent = leadingWhitespace.length > 0 ? leadingWhitespace : indent;
    const words = paragraph.trim().split(/\s+/);
    let line = baseIndent;

    for (const word of words) {
      if (line.trim().length === 0) {
        line = baseIndent + word;
        continue;
      }

      const candidate = `${line} ${word}`;
      if (candidate.length <= available) {
        line = candidate;
        continue;
      }

      wrapped.push(line);

      if (word.length >= available) {
        let remaining = word;
        while (remaining.length > available) {
          wrapped.push(remaining.slice(0, available));
          remaining = remaining.slice(available);
        }
        line = baseIndent + remaining;
      } else {
        line = baseIndent + word;
      }
    }

    if (line.length > 0) {
      wrapped.push(line);
    }
  }

  return wrapped.join('\n');
}

export function wrapWithPrefix(prefix: string, text: string, width: number): string {
  if (width <= prefix.length + 1) {
    return `${prefix}${normalizeTerminalText(text)}`;
  }

  const bodyWidth = Math.max(1, width - prefix.length);
  const wrapped = wrapText(text, bodyWidth, '');
  const lines = wrapped.split('\n');
  if (lines.length === 0) {
    return prefix;
  }

  const indent = ' '.repeat(prefix.length);
  return `${prefix}${lines[0] ?? ''}${
    lines.length > 1 ? `\n${lines.slice(1).map((line) => `${indent}${line}`).join('\n')}` : ''
  }`;
}
