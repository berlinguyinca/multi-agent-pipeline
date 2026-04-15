import { describe, expect, it, vi } from 'vitest';
import { maybeSelfUpdate, shouldAttemptSelfUpdate } from '../src/self-update.js';

describe('shouldAttemptSelfUpdate', () => {
  it('skips help and version flags', () => {
    expect(shouldAttemptSelfUpdate(['--help'])).toBe(false);
    expect(shouldAttemptSelfUpdate(['--version'])).toBe(false);
  });

  it('skips when MAP_NO_UPDATE is set', () => {
    expect(shouldAttemptSelfUpdate(['map'], { MAP_NO_UPDATE: '1' })).toBe(false);
  });
});

describe('maybeSelfUpdate', () => {
  it('skips updating when help is requested', async () => {
    const execFileFn = vi.fn();
    const result = await maybeSelfUpdate(['--help'], {
      execFileFn: execFileFn as never,
      moduleUrl: new URL('file:///tmp/project/src/cli.ts').href,
    });

    expect(result).toEqual({
      attempted: false,
      updated: false,
      skippedReason: 'disabled',
    });
    expect(execFileFn).not.toHaveBeenCalled();
  });

  it('updates a clean git checkout when behind origin', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const execFileFn = vi.fn(async (file: string, args: string[]) => {
      calls.push({ file, args });

      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --is-inside-work-tree')) {
        return { stdout: 'true\n', stderr: '' };
      }
      if (cmd.includes('status --porcelain')) {
        return { stdout: '', stderr: '' };
      }
      if (cmd.includes('symbolic-ref --quiet --short HEAD')) {
        return { stdout: 'main\n', stderr: '' };
      }
      if (cmd.includes('fetch origin main')) {
        return { stdout: '', stderr: '' };
      }
      if (cmd.includes('rev-list --left-right --count HEAD...origin/main')) {
        return { stdout: '0\t2\n', stderr: '' };
      }
      if (cmd.includes('pull --ff-only origin main')) {
        return { stdout: '', stderr: '' };
      }

      throw new Error(`Unexpected git call: ${cmd}`);
    });

    const result = await maybeSelfUpdate(['map'], {
      execFileFn: execFileFn as never,
      moduleUrl: new URL('file:///tmp/project/src/cli.ts').href,
    });

    expect(result.updated).toBe(true);
    expect(calls.map((call) => call.args.join(' '))).toEqual([
      '-C /tmp/project rev-parse --is-inside-work-tree',
      '-C /tmp/project status --porcelain',
      '-C /tmp/project symbolic-ref --quiet --short HEAD',
      '-C /tmp/project fetch origin main',
      '-C /tmp/project rev-list --left-right --count HEAD...origin/main',
      '-C /tmp/project pull --ff-only origin main',
    ]);
  });

  it('skips dirty worktrees by default', async () => {
    const execFileFn = vi.fn(async (file: string, args: string[]) => {
      const cmd = args.join(' ');
      if (cmd.includes('rev-parse --is-inside-work-tree')) {
        return { stdout: 'true\n', stderr: '' };
      }
      if (cmd.includes('status --porcelain')) {
        return { stdout: ' M src/cli.ts\n', stderr: '' };
      }
      throw new Error(`Unexpected git call: ${cmd}`);
    });

    const result = await maybeSelfUpdate(['map'], {
      execFileFn: execFileFn as never,
      moduleUrl: new URL('file:///tmp/project/src/cli.ts').href,
    });

    expect(result.updated).toBe(false);
    expect(result.skippedReason).toBe('dirty-worktree');
  });
});
