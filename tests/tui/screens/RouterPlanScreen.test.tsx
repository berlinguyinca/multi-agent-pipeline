import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import RouterPlanScreen from '../../../src/tui/screens/RouterPlanScreen.js';
import type { DAGPlan } from '../../../src/types/dag.js';

describe('RouterPlanScreen', () => {
  const plan: DAGPlan = {
    plan: [
      { id: 'step-1', agent: 'researcher', task: 'Research partitioning', dependsOn: [] },
      { id: 'step-2', agent: 'coder', task: 'Implement migration', dependsOn: ['step-1'] },
    ],
  };

  it('renders the plan title', () => {
    const { lastFrame } = render(
      React.createElement(RouterPlanScreen, { plan, onApprove: vi.fn(), onCancel: vi.fn() }),
    );
    expect(lastFrame()).toContain('Router Plan');
  });

  it('shows all agent names', () => {
    const { lastFrame } = render(
      React.createElement(RouterPlanScreen, { plan, onApprove: vi.fn(), onCancel: vi.fn() }),
    );
    expect(lastFrame()).toContain('researcher');
    expect(lastFrame()).toContain('coder');
  });

  it('shows step tasks', () => {
    const { lastFrame } = render(
      React.createElement(RouterPlanScreen, { plan, onApprove: vi.fn(), onCancel: vi.fn() }),
    );
    expect(lastFrame()).toContain('Research partitioning');
    expect(lastFrame()).toContain('Implement migration');
  });

  it('shows dependencies', () => {
    const { lastFrame } = render(
      React.createElement(RouterPlanScreen, { plan, onApprove: vi.fn(), onCancel: vi.fn() }),
    );
    expect(lastFrame()).toContain('step-1');
  });
});
