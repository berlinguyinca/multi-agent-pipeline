import React from 'react';
import { Box, Text } from 'ink';
import type { DAGPlan } from '../../types/dag.js';

interface RouterPlanScreenProps {
  plan: DAGPlan;
  onApprove: () => void;
  onCancel: () => void;
}

export default function RouterPlanScreen({ plan, onApprove: _onApprove, onCancel: _onCancel }: RouterPlanScreenProps) {
  return (
    React.createElement(Box, { flexDirection: 'column', padding: 1 },
      React.createElement(Text, { bold: true, color: 'cyan' }, '  Router Plan'),
      React.createElement(Text, { dimColor: true }, '  ────────────────────────────────────────'),
      React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
        ...plan.plan.map((step) =>
          React.createElement(Box, { key: step.id, flexDirection: 'column', marginLeft: 2, marginBottom: 1 },
            React.createElement(Text, { bold: true },
              `${step.id} `, React.createElement(Text, { color: 'green' }, `[${step.agent}]`),
            ),
            React.createElement(Text, { dimColor: true }, `  ${step.task}`),
            step.dependsOn.length > 0
              ? React.createElement(Text, { dimColor: true, color: 'yellow' },
                  `  depends on: ${step.dependsOn.join(', ')}`,
                )
              : null,
          ),
        ),
      ),
      React.createElement(Box, { marginTop: 1, marginLeft: 2 },
        React.createElement(Text, { dimColor: true }, 'Enter: Execute  |  Esc: Cancel'),
      ),
    )
  );
}
