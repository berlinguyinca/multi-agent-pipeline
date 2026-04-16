const ANSI_SINGLE_CHAR_PATTERN = /\u001b[@-Z\\-_]/g;

export function normalizeTerminalText(text: string): string {
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

  function eraseLine(mode: number): void {
    if (mode === 1) {
      line.splice(0, cursor);
      cursor = 0;
      return;
    }
    if (mode === 2) {
      line = [];
      cursor = 0;
      return;
    }
    line.splice(cursor);
  }

  function parseCsi(start: number): number | null {
    const markerLength = text[start] === '\u001b' ? 2 : 3;
    let end = start + markerLength;
    while (end < text.length && !/[A-Za-z~]/.test(text[end]!)) {
      end += 1;
    }
    if (end >= text.length) return null;

    const final = text[end]!;
    const params = text.slice(start + markerLength, end);
    const firstParam = Number.parseInt(params.split(';')[0] || '0', 10);
    const amount = Number.isFinite(firstParam) && firstParam > 0 ? firstParam : 1;

    switch (final) {
      case 'C':
        cursor += amount;
        break;
      case 'D':
        cursor = Math.max(0, cursor - amount);
        break;
      case 'G':
        cursor = Math.max(0, amount - 1);
        break;
      case 'K':
        eraseLine(Number.isFinite(firstParam) ? firstParam : 0);
        break;
      default:
        break;
    }

    return end;
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (char === '\u001b' && text[index + 1] === '[') {
      const end = parseCsi(index);
      if (end !== null) {
        index = end;
        continue;
      }
    }

    if (char === '\\' && text[index + 1] === 'e' && text[index + 2] === '[') {
      const end = parseCsi(index);
      if (end !== null) {
        index = end;
        continue;
      }
    }

    if (char === '\u001b') {
      const single = text.slice(index, index + 2);
      if (ANSI_SINGLE_CHAR_PATTERN.test(single)) {
        ANSI_SINGLE_CHAR_PATTERN.lastIndex = 0;
        index += 1;
        continue;
      }
      ANSI_SINGLE_CHAR_PATTERN.lastIndex = 0;
      continue;
    }

    if (char === '\u0007') continue;

    if (char === '\u0008' || char === '\u007f') {
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
