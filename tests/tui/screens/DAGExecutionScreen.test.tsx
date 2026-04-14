import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import DAGExecutionScreen from '../../../src/tui/screens/DAGExecutionScreen.js';
import type { StepResult } from '../../../src/types/dag.js';

describe('DAGExecutionScreen', () => {
  it('shows running steps', () => {
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'running', duration: 5000 },
      { id: 'step-2', agent: 'coder', task: 'Build', status: 'pending' },
    ];
    const { lastFrame } = render(React.createElement(DAGExecutionScreen, { steps }));
    expect(lastFrame()).toContain('researcher');
    expect(lastFrame()).toContain('running');
  });

  it('shows completed steps', () => {
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', outputType: 'answer', duration: 8000 },
    ];
    const { lastFrame } = render(React.createElement(DAGExecutionScreen, { steps }));
    expect(lastFrame()).toContain('completed');
  });

  it('shows failed steps with error', () => {
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'database', task: 'Query', status: 'failed', error: 'connection refused', duration: 2000 },
    ];
    const { lastFrame } = render(React.createElement(DAGExecutionScreen, { steps }));
    expect(lastFrame()).toContain('failed');
  });

  it('shows pending steps', () => {
    const steps: StepResult[] = [
      { id: 'step-1', agent: 'researcher', task: 'Research', status: 'running', duration: 1000 },
      { id: 'step-2', agent: 'coder', task: 'Build', status: 'pending' },
    ];
    const { lastFrame } = render(React.createElement(DAGExecutionScreen, { steps }));
    expect(lastFrame()).toContain('pending');
  });
});
