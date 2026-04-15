import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildPromptHistoryPath,
  loadPromptHistory,
  recordPromptHistory,
} from '../../src/tui/prompt-history.js';

describe('prompt-history', () => {
  let tmpDir = '';

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  it('writes and reads recent prompts', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-prompt-history-'));

    const history = await recordPromptHistory(tmpDir, {
      prompt: 'Refactor the CLI',
      githubIssueUrl: 'https://github.com/org/repo/issues/1',
    });

    expect(history[0]?.prompt).toBe('Refactor the CLI');
    expect(buildPromptHistoryPath(tmpDir)).toContain(path.join('.map', 'prompt-history.json'));

    const loaded = await loadPromptHistory(tmpDir);
    expect(loaded[0]?.prompt).toBe('Refactor the CLI');
    expect(loaded[0]?.githubIssueUrl).toBe('https://github.com/org/repo/issues/1');
  });

  it('dedupes identical prompt/url pairs and keeps the newest first', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-prompt-history-dedupe-'));

    await recordPromptHistory(tmpDir, { prompt: 'First prompt' });
    await recordPromptHistory(tmpDir, { prompt: 'Second prompt' });
    const history = await recordPromptHistory(tmpDir, { prompt: 'First prompt' });

    expect(history[0]?.prompt).toBe('First prompt');
    expect(history).toHaveLength(2);
    expect(history[1]?.prompt).toBe('Second prompt');
  });

  it('caps the history at 20 entries', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-prompt-history-cap-'));

    for (let i = 0; i < 25; i += 1) {
      await recordPromptHistory(tmpDir, { prompt: `Prompt ${i}` });
    }

    const loaded = await loadPromptHistory(tmpDir);
    expect(loaded).toHaveLength(20);
    expect(loaded[0]?.prompt).toBe('Prompt 24');
    expect(loaded[19]?.prompt).toBe('Prompt 5');
  });
});
