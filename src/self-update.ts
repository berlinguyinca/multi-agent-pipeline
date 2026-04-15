import * as path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);

export interface SelfUpdateResult {
  attempted: boolean;
  updated: boolean;
  skippedReason?: string;
  error?: string;
}

export interface SelfUpdateDependencies {
  env?: NodeJS.ProcessEnv;
  moduleUrl?: string;
  execFileFn?: typeof execFile;
  warn?: (message: string) => void;
}

export function shouldAttemptSelfUpdate(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env['MAP_NO_UPDATE'] === '1') {
    return false;
  }

  if (env['CI'] === '1' || env['CI'] === 'true') {
    return false;
  }

  if (args.includes('--help') || args.includes('-h') || args.includes('--version') || args.includes('-v')) {
    return false;
  }

  return true;
}

export async function maybeSelfUpdate(
  args: string[],
  dependencies: SelfUpdateDependencies = {},
): Promise<SelfUpdateResult> {
  const env = dependencies.env ?? process.env;
  if (!shouldAttemptSelfUpdate(args, env)) {
    return { attempted: false, updated: false, skippedReason: 'disabled' };
  }

  const moduleUrl = dependencies.moduleUrl ?? import.meta.url;
  const execFileFn = dependencies.execFileFn ?? execFile;
  const warn = dependencies.warn ?? console.warn;
  const repoRoot = getRepoRoot(moduleUrl);

  if (!(await isGitRepo(repoRoot, execFileFn))) {
    return { attempted: false, updated: false, skippedReason: 'not-a-git-checkout' };
  }

  const dirty = await isDirty(repoRoot, execFileFn);
  if (dirty && env['MAP_FORCE_UPDATE'] !== '1') {
    return { attempted: true, updated: false, skippedReason: 'dirty-worktree' };
  }

  const branch = env['MAP_BRANCH']?.trim() || (await getCurrentBranch(repoRoot, execFileFn));
  if (!branch) {
    return { attempted: true, updated: false, skippedReason: 'detached-head' };
  }

  try {
    await runGit(repoRoot, ['fetch', 'origin', branch], execFileFn);

    const behind = await getBehindCount(repoRoot, branch, execFileFn);
    if (behind === 0) {
      return { attempted: true, updated: false, skippedReason: 'up-to-date' };
    }

    await runGit(repoRoot, ['pull', '--ff-only', 'origin', branch], execFileFn);
    return { attempted: true, updated: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`[MAP] self-update skipped: ${message}`);
    return { attempted: true, updated: false, error: message };
  }
}

function getRepoRoot(moduleUrl: string): string {
  return path.dirname(path.dirname(fileURLToPath(moduleUrl)));
}

async function isGitRepo(
  repoRoot: string,
  execFileFn: typeof execFile,
): Promise<boolean> {
  try {
    await runGit(repoRoot, ['rev-parse', '--is-inside-work-tree'], execFileFn);
    return true;
  } catch {
    return false;
  }
}

async function isDirty(
  repoRoot: string,
  execFileFn: typeof execFile,
): Promise<boolean> {
  const { stdout } = await runGit(repoRoot, ['status', '--porcelain'], execFileFn);
  return stdout.trim().length > 0;
}

async function getCurrentBranch(
  repoRoot: string,
  execFileFn: typeof execFile,
): Promise<string | null> {
  try {
    const { stdout } = await runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], execFileFn);
    const branch = stdout.trim();
    return branch === '' ? null : branch;
  } catch {
    return null;
  }
}

async function getBehindCount(
  repoRoot: string,
  branch: string,
  execFileFn: typeof execFile,
): Promise<number> {
  const { stdout } = await runGit(
    repoRoot,
    ['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`],
    execFileFn,
  );
  const [aheadRaw, behindRaw] = stdout.trim().split(/\s+/);
  const ahead = Number.parseInt(aheadRaw ?? '0', 10);
  const behind = Number.parseInt(behindRaw ?? '0', 10);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
    return 0;
  }
  return behind;
}

async function runGit(
  repoRoot: string,
  args: string[],
  execFileFn: typeof execFile,
): Promise<{ stdout: string; stderr: string }> {
  return execFileFn('git', ['-C', repoRoot, ...args], { maxBuffer: 1024 * 1024 });
}
