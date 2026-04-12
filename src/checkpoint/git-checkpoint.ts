import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { CheckpointMeta } from '../types/checkpoint.js';
import { formatCheckpointMessage, parseCheckpointMessage } from './parser.js';

const execFile = promisify(execFileCb);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

export async function ensureGitRepo(dir: string): Promise<void> {
  const gitDir = path.join(dir, '.git');
  try {
    await fs.stat(gitDir);
    // Already a git repo
  } catch {
    await git(dir, ['init']);
  }
}

export async function createCheckpoint(
  dir: string,
  meta: CheckpointMeta,
  stateJson: string
): Promise<string> {
  const mapDir = path.join(dir, '.map');
  await fs.mkdir(mapDir, { recursive: true });

  const stateFile = path.join(mapDir, 'state.json');
  await fs.writeFile(stateFile, stateJson, 'utf-8');

  await git(dir, ['add', '-A']);

  const message = formatCheckpointMessage(meta);
  await git(dir, ['commit', '--allow-empty', '-m', message]);

  const hash = await git(dir, ['rev-parse', 'HEAD']);
  return hash;
}

export async function listCheckpoints(dir: string): Promise<CheckpointMeta[]> {
  let logOutput: string;
  try {
    logOutput = await git(dir, [
      'log',
      '--pretty=format:%H %s',
      `--grep=[MAP]`,
    ]);
  } catch {
    return [];
  }

  if (logOutput === '') {
    return [];
  }

  const checkpoints: CheckpointMeta[] = [];

  for (const line of logOutput.split('\n')) {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;

    const commitHash = line.slice(0, spaceIdx);
    const subject = line.slice(spaceIdx + 1);

    const parsed = parseCheckpointMessage(subject);
    if (parsed !== null) {
      checkpoints.push({ ...parsed, commitHash });
    }
  }

  return checkpoints;
}
