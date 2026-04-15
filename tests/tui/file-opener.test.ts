import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { openFile } from '../../src/tui/file-opener.js';

describe('openFile', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('opens files on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    execFileSyncMock.mockReturnValue(undefined);

    expect(openFile('/tmp/test.log')).toBe(true);
    expect(execFileSyncMock).toHaveBeenCalledWith('open', ['/tmp/test.log'], { stdio: 'ignore' });
  });

  it('returns false on unsupported platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });

    expect(openFile('/tmp/test.log')).toBe(false);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});
