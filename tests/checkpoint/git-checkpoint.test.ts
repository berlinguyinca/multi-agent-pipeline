import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  ensureGitRepo,
  createCheckpoint,
  listCheckpoints,
} from '../../src/checkpoint/git-checkpoint.js';
import type { CheckpointMeta } from '../../src/types/checkpoint.js';

describe('git-checkpoint', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-git-test-'));
    // Configure git identity for the test repo
    process.env['GIT_AUTHOR_NAME'] = 'Test';
    process.env['GIT_AUTHOR_EMAIL'] = 'test@test.com';
    process.env['GIT_COMMITTER_NAME'] = 'Test';
    process.env['GIT_COMMITTER_EMAIL'] = 'test@test.com';
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    delete process.env['GIT_AUTHOR_NAME'];
    delete process.env['GIT_AUTHOR_EMAIL'];
    delete process.env['GIT_COMMITTER_NAME'];
    delete process.env['GIT_COMMITTER_EMAIL'];
  });

  describe('ensureGitRepo', () => {
    it('initializes a git repo in a new directory', async () => {
      await ensureGitRepo(tmpDir);
      const gitDir = path.join(tmpDir, '.git');
      const stat = await fs.stat(gitDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('is idempotent on an existing repo', async () => {
      await ensureGitRepo(tmpDir);
      // Should not throw
      await expect(ensureGitRepo(tmpDir)).resolves.not.toThrow();
    });
  });

  describe('createCheckpoint', () => {
    it('creates a commit and returns a hash', async () => {
      await ensureGitRepo(tmpDir);

      const meta: CheckpointMeta = {
        pipelineId: 'pipe-001',
        name: 'test-pipeline',
        stage: 'specifying',
        iteration: 1,
        agents: { spec: { adapter: 'claude' } },
        timestamp: new Date('2024-01-15T10:00:00.000Z'),
        commitHash: '',
      };

      const hash = await createCheckpoint(tmpDir, meta, JSON.stringify({ test: true }));
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('writes state to .map/state.json', async () => {
      await ensureGitRepo(tmpDir);

      const meta: CheckpointMeta = {
        pipelineId: 'pipe-002',
        name: 'test-pipeline',
        stage: 'reviewing',
        iteration: 2,
        agents: {},
        timestamp: new Date(),
        commitHash: '',
      };

      const stateJson = JSON.stringify({ stage: 'reviewing', data: 'test' });
      await createCheckpoint(tmpDir, meta, stateJson);

      const stateFile = path.join(tmpDir, '.map', 'state.json');
      const content = await fs.readFile(stateFile, 'utf-8');
      expect(content).toBe(stateJson);
    });
  });

  describe('listCheckpoints', () => {
    it('returns created checkpoints', async () => {
      await ensureGitRepo(tmpDir);

      const meta1: CheckpointMeta = {
        pipelineId: 'pipe-100',
        name: 'pipeline-one',
        stage: 'specifying',
        iteration: 1,
        agents: {},
        timestamp: new Date('2024-01-15T10:00:00.000Z'),
        commitHash: '',
      };

      const meta2: CheckpointMeta = {
        pipelineId: 'pipe-100',
        name: 'pipeline-one',
        stage: 'reviewing',
        iteration: 1,
        agents: {},
        timestamp: new Date('2024-01-15T11:00:00.000Z'),
        commitHash: '',
      };

      await createCheckpoint(tmpDir, meta1, '{}');
      await createCheckpoint(tmpDir, meta2, '{}');

      const checkpoints = await listCheckpoints(tmpDir);
      expect(checkpoints.length).toBe(2);
      // Most recent first (git log order)
      expect(checkpoints[0]?.pipelineId).toBe('pipe-100');
    });

    it('returns empty array when no checkpoints exist', async () => {
      await ensureGitRepo(tmpDir);
      const checkpoints = await listCheckpoints(tmpDir);
      expect(checkpoints).toEqual([]);
    });
  });
});
