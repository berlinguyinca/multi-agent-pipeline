import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import ExecuteScreen from '../../../src/tui/screens/ExecuteScreen.js';

const stages = [
  { name: 'Spec', status: 'complete' as const, agent: 'claude' },
  { name: 'Review', status: 'complete' as const, agent: 'codex' },
  { name: 'Execute', status: 'active' as const, agent: 'ollama' },
];

const tests = [
  { name: 'user can login', status: 'passing' as const },
  { name: 'user can logout', status: 'pending' as const },
  { name: 'user sees dashboard', status: 'writing' as const },
];

describe('ExecuteScreen', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(
      <ExecuteScreen
        stages={stages}
        iteration={1}
        output="Running tests..."
        streaming={true}
        tests={tests}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows test names', () => {
    const { lastFrame } = render(
      <ExecuteScreen
        stages={stages}
        iteration={1}
        output=""
        streaming={false}
        tests={tests}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('user can login');
  });

  it('shows output content', () => {
    const { lastFrame } = render(
      <ExecuteScreen
        stages={stages}
        iteration={1}
        output="npx vitest run..."
        streaming={false}
        tests={tests}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('npx vitest run...');
  });

  it('renders with empty tests', () => {
    const { lastFrame } = render(
      <ExecuteScreen
        stages={stages}
        iteration={1}
        output=""
        streaming={false}
        tests={[]}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('renders with streaming true', () => {
    const { lastFrame } = render(
      <ExecuteScreen
        stages={stages}
        iteration={1}
        output="partial output"
        streaming={true}
        tests={tests}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows iteration', () => {
    const { lastFrame } = render(
      <ExecuteScreen
        stages={stages}
        iteration={2}
        output=""
        streaming={false}
        tests={tests}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('2');
  });
});
