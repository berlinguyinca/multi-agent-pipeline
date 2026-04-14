import React from 'react';
import { Box, Text } from 'ink';
import type { StepResult } from '../../types/dag.js';

interface DAGExecutionScreenProps {
  steps: StepResult[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'gray',
  running: 'yellow',
  completed: 'green',
  failed: 'red',
  skipped: 'gray',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  running: '◉',
  completed: '●',
  failed: '✗',
  skipped: '◌',
};

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function DAGExecutionScreen({ steps }: DAGExecutionScreenProps) {
  return (
    React.createElement(Box, { flexDirection: 'column', padding: 1 },
      React.createElement(Text, { bold: true, color: 'cyan' }, '  Executing Plan'),
      React.createElement(Text, { dimColor: true }, '  ────────────────────────────────────────'),
      React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
        ...steps.map((step) =>
          React.createElement(Box, { key: step.id, marginLeft: 2, marginBottom: 0 },
            React.createElement(Text, { color: STATUS_COLORS[step.status] ?? 'white' }, `${STATUS_ICONS[step.status] ?? '?'} `),
            React.createElement(Text, { bold: true }, `${step.id} `),
            React.createElement(Text, { color: 'green' }, `[${step.agent}] `),
            React.createElement(Text, { dimColor: true }, step.status),
            step.duration ? React.createElement(Text, { dimColor: true }, ` ${formatDuration(step.duration)}`) : null,
            step.error ? React.createElement(Text, { color: 'red' }, ` — ${step.error}`) : null,
          ),
        ),
      ),
    )
  );
}
