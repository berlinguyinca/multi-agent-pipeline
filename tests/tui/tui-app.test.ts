import { describe, it, expect, vi } from 'vitest';
import { createTuiApp } from '../../src/tui/tui-app.js';
import type { PipelineConfig } from '../../src/types/config.js';
import type { DetectionResult } from '../../src/types/adapter.js';

const config: PipelineConfig = {
  agents: {
    spec: { adapter: 'claude' },
    review: { adapter: 'codex' },
    qa: { adapter: 'codex' },
    execute: { adapter: 'claude' },
    docs: { adapter: 'claude' },
  },
  ollama: { host: 'http://localhost:11434' },
  quality: { maxSpecQaIterations: 3, maxCodeQaIterations: 3 },
  outputDir: './output',
  gitCheckpoints: false,
  headless: {
    totalTimeoutMs: 60 * 60 * 1000,
    inactivityTimeoutMs: 10 * 60 * 1000,
    pollIntervalMs: 10 * 1000,
  },
};

const detection: DetectionResult = {
  claude: { installed: true, version: '1.0' },
  codex: { installed: false },
  ollama: { installed: false, models: [] },
};

describe('createTuiApp', () => {
  it('returns an object with run and destroy methods', () => {
    const app = createTuiApp({ config, detection });
    expect(typeof app.run).toBe('function');
    expect(typeof app.destroy).toBe('function');
    // Don't call run() — it would create a full blessed screen and block
  });

  it('destroy before run does not throw', () => {
    const app = createTuiApp({ config, detection });
    expect(() => app.destroy()).not.toThrow();
  });

  it('destroy is idempotent (call twice)', () => {
    const app = createTuiApp({ config, detection });
    expect(() => {
      app.destroy();
      app.destroy();
    }).not.toThrow();
  });

  it('creates with initialPrompt without throwing', () => {
    expect(() =>
      createTuiApp({ config, detection, initialPrompt: 'Build a login page' }),
    ).not.toThrow();
  });

  it('creates with initialGithubIssueUrl without throwing', () => {
    expect(() =>
      createTuiApp({
        config,
        detection,
        initialGithubIssueUrl: 'https://github.com/owner/repo/issues/1',
      }),
    ).not.toThrow();
  });

  it('creates in v2 routing mode without throwing', () => {
    expect(() =>
      createTuiApp({
        config,
        detection,
        initialPrompt: 'Build a feature with routing',
        useV2: true,
      }),
    ).not.toThrow();
  });

  it('defaults to v2 routing mode without throwing', () => {
    expect(() =>
      createTuiApp({
        config,
        detection,
        initialPrompt: 'Build a feature with default smart routing',
      }),
    ).not.toThrow();
  });

  it('creates in classic mode when useV2 is false', () => {
    expect(() =>
      createTuiApp({
        config,
        detection,
        initialPrompt: 'Build a feature with classic routing',
        useV2: false,
      }),
    ).not.toThrow();
  });
});
