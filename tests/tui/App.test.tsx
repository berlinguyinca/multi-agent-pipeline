import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import App from '../../src/tui/App.js';
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
  ollama: {
    host: 'http://localhost:11434',
  },
  quality: {
    maxSpecQaIterations: 3,
    maxCodeQaIterations: 3,
  },
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

describe('App', () => {
  it('renders in idle state without errors', () => {
    const { lastFrame } = render(
      <App config={config} detection={detection} />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows welcome screen content in idle state', () => {
    const { lastFrame } = render(
      <App config={config} detection={detection} />
    );
    // In idle state, the WelcomeScreen should show (which has Logo + AgentPicker)
    expect(lastFrame()).toBeTruthy();
  });

  it('renders with initialPrompt', () => {
    const { lastFrame } = render(
      <App config={config} detection={detection} initialPrompt="Build a login page" />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('renders with all agents available', () => {
    const fullDetection: DetectionResult = {
      claude: { installed: true },
      codex: { installed: true },
      ollama: { installed: true, models: ['llama2', 'mistral'] },
    };
    const { lastFrame } = render(
      <App config={config} detection={fullDetection} />
    );
    expect(lastFrame()).toBeTruthy();
  });
});
