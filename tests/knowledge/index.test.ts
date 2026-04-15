import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildKnowledgeIndex,
  queryKnowledge,
  recordLearningCandidate,
  canonicalizeLearningCandidates,
} from '../../src/knowledge/index.js';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('knowledge index', () => {
  it('indexes local and global markdown knowledge with freshness metadata', async () => {
    const cwd = await makeTempDir('map-knowledge-local-');
    const globalRoot = await makeTempDir('map-knowledge-global-');
    const localRoot = path.join(cwd, '.map', 'brain', 'local');
    await fs.mkdir(localRoot, { recursive: true });
    await fs.writeFile(
      path.join(localRoot, 'ai-notes.md'),
      '# Prompting\n\nAI model behavior changes quickly and should be revalidated.\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(globalRoot, 'woodworking.md'),
      '# Mortise and Tenon\n\nA stable woodworking technique.\n',
      'utf8',
    );

    const index = await buildKnowledgeIndex({ cwd, globalRoot });
    expect(index.entries).toHaveLength(2);
    const aiEntry = index.entries.find((entry) => entry.title === 'Prompting');
    const woodEntry = index.entries.find((entry) => entry.title === 'Mortise and Tenon');
    expect(aiEntry?.scope).toBe('local');
    expect(aiEntry?.freshnessClass).toBe('fast');
    expect(woodEntry?.scope).toBe('global');
    expect(woodEntry?.freshnessClass).toBe('evergreen');
  });

  it('returns compact query results ranked by relevance', async () => {
    const cwd = await makeTempDir('map-knowledge-query-');
    const localRoot = path.join(cwd, '.map', 'brain', 'local');
    await fs.mkdir(localRoot, { recursive: true });
    await fs.writeFile(
      path.join(localRoot, 'sql-tuning.md'),
      '# Query tuning\n\nUse indexes and explain plans for slow joins.\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(localRoot, 'design.md'),
      '# UX notes\n\nFocus on clear primary actions.\n',
      'utf8',
    );

    await buildKnowledgeIndex({ cwd });
    const results = await queryKnowledge({
      cwd,
      query: 'slow SQL joins',
      limit: 3,
    });
    expect(results[0]?.title).toBe('Query tuning');
    expect(results[0]?.snippet).toContain('indexes');
    expect(results[0]?.content.length).toBeLessThanOrEqual(280);
  });

  it('records learning candidates and canonicalizes them into lessons', async () => {
    const cwd = await makeTempDir('map-knowledge-learn-');
    const candidate = await recordLearningCandidate({
      cwd,
      title: 'Compile failures need import verification',
      lesson:
        'When TypeScript reports missing names after generation, verify imports before broader refactors.',
      sourceTask: 'Fix build failure',
      confidence: 'high',
      freshnessHint: 'medium',
    });

    expect(candidate).toContain(path.join('.map', 'brain', 'local', 'candidates'));

    const promoted = await canonicalizeLearningCandidates({ cwd });
    expect(promoted).toHaveLength(1);
    expect(promoted[0]).toContain(path.join('.map', 'brain', 'local', 'lessons'));

    const index = await buildKnowledgeIndex({ cwd });
    expect(index.entries.some((entry) => entry.path.includes('lessons'))).toBe(true);
  });
});
