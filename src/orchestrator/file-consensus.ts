import { exec, execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { FileOutputConsensusConfig } from '../types/config.js';
import type { StepResult } from '../types/dag.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface FileConsensusRunCandidate {
  (candidateWorkingDir: string, candidateIndex: number): Promise<string>;
}

export interface FileConsensusOptions {
  workingDir: string;
  stepId: string;
  config: FileOutputConsensusConfig;
  provider?: string;
  model?: string;
  runCandidate: FileConsensusRunCandidate;
}

export interface FileConsensusResult {
  output: string;
  metadata: NonNullable<StepResult['consensus']>;
}

interface CandidateResult {
  index: number;
  worktreePath: string;
  output?: string;
  patch: string;
  changedFiles: string[];
  verificationPassed: boolean;
  verificationOutput: string;
  error?: string;
}

export async function runFileConsensusInWorktrees(
  options: FileConsensusOptions,
): Promise<FileConsensusResult> {
  const prepared = await prepareConsensusRepository(options.workingDir);
  const repoRoot = prepared.repoRoot;
  const head = await gitOutput(prepared.repoRoot, ['rev-parse', 'HEAD']);
  const worktreeRoot = path.join(
    repoRoot,
    '.map',
    'worktrees',
    'consensus',
    `${sanitizePathPart(options.stepId)}-${Date.now()}`,
  );
  await fs.mkdir(worktreeRoot, { recursive: true });

  const candidates: CandidateResult[] = [];
  let completedSuccessfully = false;
  try {
    for (let index = 0; index < options.config.runs; index += 1) {
      candidates.push(await runCandidateWorktree({
        ...options,
        repoRoot,
        head,
        worktreePath: path.join(worktreeRoot, `candidate-${index + 1}`),
        index,
      }));
    }

    const selected = selectBestCandidate(candidates);
    await applyPatch(prepared.applyDir, selected.patch);
    await runVerificationCommands(prepared.applyDir, options.config.verificationCommands);
    completedSuccessfully = true;

    return {
      output: selected.output ?? '',
      metadata: {
        enabled: true,
        runs: options.config.runs,
        candidateCount: candidates.length,
        selectedRun: selected.index + 1,
        agreement: selected.verificationPassed ? 1 : 0,
        method: 'worktree-best-passing-diff',
        isolation: 'git-worktree',
        verificationPassed: selected.verificationPassed,
        changedFiles: selected.changedFiles,
        participants: candidates.map((candidate) => ({
          run: candidate.index + 1,
          provider: options.provider,
          model: options.model,
          status: candidate.index === selected.index
            ? 'selected'
            : candidate.verificationPassed
              ? 'valid'
              : 'failed',
          contribution: candidate.index === selected.index ? 1 : 0,
          detail: candidate.verificationPassed
            ? `${candidate.changedFiles.length} changed file${candidate.changedFiles.length === 1 ? '' : 's'}`
            : candidate.error ?? candidate.verificationOutput,
        })),
      },
    };
  } finally {
    if (completedSuccessfully || !options.config.keepWorktreesOnFailure) {
      await Promise.allSettled(
        candidates.map((candidate) => removeWorktree(repoRoot, candidate.worktreePath)),
      );
      await fs.rm(worktreeRoot, { recursive: true, force: true });
    }
    if (prepared.cleanupRepoRoot && (completedSuccessfully || !options.config.keepWorktreesOnFailure)) {
      await fs.rm(prepared.repoRoot, { recursive: true, force: true });
    }
  }
}

async function prepareConsensusRepository(workingDir: string): Promise<{
  repoRoot: string;
  applyDir: string;
  cleanupRepoRoot: boolean;
}> {
  const resolvedWorkingDir = path.resolve(workingDir);
  const existingRepoRoot = await gitOutput(resolvedWorkingDir, ['rev-parse', '--show-toplevel']).catch(() => null);

  if (existingRepoRoot && path.resolve(existingRepoRoot) === resolvedWorkingDir) {
    const status = await gitOutput(existingRepoRoot, ['status', '--porcelain']);
    if (status.trim().length > 0) {
      throw new Error('File-output consensus requires a clean git working tree before creating candidate worktrees');
    }
    return { repoRoot: existingRepoRoot, applyDir: resolvedWorkingDir, cleanupRepoRoot: false };
  }

  const scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'map-file-consensus-'));
  const scratchRepo = path.join(scratchRoot, 'repo');
  await fs.mkdir(scratchRepo, { recursive: true });
  await fs.mkdir(resolvedWorkingDir, { recursive: true });
  await fs.cp(resolvedWorkingDir, scratchRepo, {
    recursive: true,
    force: true,
    filter: (source) => {
      const base = path.basename(source);
      return base !== '.git' && !(base === 'worktrees' && source.includes(`${path.sep}.map${path.sep}`));
    },
  });
  await execFileAsync('git', ['init'], { cwd: scratchRepo });
  await execFileAsync('git', ['config', 'user.email', 'map@example.test'], { cwd: scratchRepo });
  await execFileAsync('git', ['config', 'user.name', 'MAP'], { cwd: scratchRepo });
  await execFileAsync('git', ['add', '-A'], { cwd: scratchRepo });
  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'baseline'], { cwd: scratchRepo });
  return { repoRoot: scratchRepo, applyDir: resolvedWorkingDir, cleanupRepoRoot: true };
}

async function runCandidateWorktree(
  options: FileConsensusOptions & {
    repoRoot: string;
    head: string;
    worktreePath: string;
    index: number;
  },
): Promise<CandidateResult> {
  await execFileAsync('git', ['worktree', 'add', '--detach', options.worktreePath, options.head], {
    cwd: options.repoRoot,
  });

  try {
    const output = await options.runCandidate(options.worktreePath, options.index);
    const verification = await runVerificationCommands(
      options.worktreePath,
      options.config.verificationCommands,
    );
    await execFileAsync('git', ['add', '-A'], { cwd: options.worktreePath });
    const patch = await gitStdout(options.worktreePath, ['diff', '--cached', '--binary', 'HEAD']);
    const changedFilesText = await gitOutput(options.worktreePath, ['diff', '--cached', '--name-only', 'HEAD']);

    return {
      index: options.index,
      worktreePath: options.worktreePath,
      output,
      patch,
      changedFiles: changedFilesText.split('\n').map((line) => line.trim()).filter(Boolean),
      verificationPassed: true,
      verificationOutput: verification,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await execFileAsync('git', ['add', '-A'], { cwd: options.worktreePath }).catch(() => undefined);
    const patch = await gitStdout(options.worktreePath, ['diff', '--cached', '--binary', 'HEAD']).catch(() => '');
    const changedFilesText = await gitOutput(options.worktreePath, ['diff', '--cached', '--name-only', 'HEAD']).catch(() => '');
    return {
      index: options.index,
      worktreePath: options.worktreePath,
      patch,
      changedFiles: changedFilesText.split('\n').map((line) => line.trim()).filter(Boolean),
      verificationPassed: false,
      verificationOutput: message,
      error: message,
    };
  }
}

function selectBestCandidate(candidates: CandidateResult[]): CandidateResult {
  const passing = candidates.filter((candidate) => candidate.verificationPassed);
  if (passing.length === 0) {
    const failures = candidates
      .map((candidate) => `candidate-${candidate.index + 1}: ${candidate.error ?? candidate.verificationOutput}`)
      .join('; ');
    throw new Error(`File-output consensus failed: no verified candidates. ${failures}`);
  }

  return passing.sort((left, right) =>
    left.changedFiles.length - right.changedFiles.length ||
    left.patch.length - right.patch.length ||
    left.index - right.index,
  )[0]!;
}

async function runVerificationCommands(cwd: string, commands: string[]): Promise<string> {
  const outputs: string[] = [];
  for (const command of commands) {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    outputs.push(stdout + stderr);
  }
  return outputs.join('\n');
}

async function applyPatch(repoRoot: string, patch: string): Promise<void> {
  if (patch.trim().length === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['apply', '--binary', '-'], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`git apply failed with code ${code}: ${stderr}`));
    });
    child.stdin.end(patch);
  });
}

async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (await gitStdout(cwd, args)).trim();
}

async function gitStdout(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function sanitizePathPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'step';
}
