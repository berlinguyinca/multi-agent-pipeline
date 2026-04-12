import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import WelcomeScreen from '../../../src/tui/screens/WelcomeScreen.js';

const detection = {
  claude: { installed: true, version: '1.0' },
  codex: { installed: false },
  ollama: { installed: true, models: ['llama2'] },
};

const agents = {
  spec: { adapter: 'claude' as const },
  review: { adapter: 'codex' as const },
  execute: { adapter: 'ollama' as const },
};

describe('WelcomeScreen', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(
      <WelcomeScreen
        onStart={vi.fn()}
        onResume={vi.fn()}
        detection={detection}
        agents={agents}
        onAssign={vi.fn()}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows stage names in agent picker', () => {
    const { lastFrame } = render(
      <WelcomeScreen
        onStart={vi.fn()}
        onResume={vi.fn()}
        detection={detection}
        agents={agents}
        onAssign={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('spec');
  });

  it('shows agent assignment section', () => {
    const { lastFrame } = render(
      <WelcomeScreen
        onStart={vi.fn()}
        onResume={vi.fn()}
        detection={detection}
        agents={agents}
        onAssign={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Agent');
  });

  it('renders with no installed agents', () => {
    const noAgentDetection = {
      claude: { installed: false },
      codex: { installed: false },
      ollama: { installed: false, models: [] },
    };
    const { lastFrame } = render(
      <WelcomeScreen
        onStart={vi.fn()}
        onResume={vi.fn()}
        detection={noAgentDetection}
        agents={agents}
        onAssign={vi.fn()}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });
});
