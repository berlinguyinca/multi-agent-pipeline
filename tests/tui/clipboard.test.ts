import { describe, it, expect, vi } from 'vitest';
import { copyToClipboard } from '../../src/tui/clipboard.js';

describe('copyToClipboard', () => {
  it('returns a boolean', () => {
    // May succeed or fail depending on OS/environment, but must return boolean
    const result = copyToClipboard('test text');
    expect(typeof result).toBe('boolean');
  });

  it('returns true on darwin when pbcopy available', () => {
    if (process.platform !== 'darwin') return;
    // On macOS CI/dev, pbcopy should be available
    const result = copyToClipboard('hello clipboard');
    expect(result).toBe(true);
  });

  it('handles empty string', () => {
    const result = copyToClipboard('');
    expect(typeof result).toBe('boolean');
  });

  it('handles multiline text', () => {
    const result = copyToClipboard('line1\nline2\nline3');
    expect(typeof result).toBe('boolean');
  });

  it('returns false on unsupported platform (mocked)', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
    const result = copyToClipboard('some text');
    expect(result).toBe(false);
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });
});
