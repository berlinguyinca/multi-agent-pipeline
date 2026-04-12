import React from 'react';
import { Box, Text } from 'ink';

interface StageInfo {
  name: string;
  status: 'waiting' | 'active' | 'complete' | 'failed';
  agent: string;
  progress?: number;
}

interface PipelineBarProps {
  stages: StageInfo[];
  iteration: number;
}

function statusIcon(status: StageInfo['status']): string {
  switch (status) {
    case 'waiting':
      return '○';
    case 'active':
      return '●';
    case 'complete':
      return '✓';
    case 'failed':
      return '✗';
  }
}

function statusColor(status: StageInfo['status']): string {
  switch (status) {
    case 'waiting':
      return 'gray';
    case 'active':
      return 'cyan';
    case 'complete':
      return 'green';
    case 'failed':
      return 'red';
  }
}

export default function PipelineBar({ stages, iteration }: PipelineBarProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text>MAP Pipeline</Text>
        <Text>{`  Iteration ${iteration}`}</Text>
      </Box>
      <Box>
        {stages.map((stage, i) => (
          <React.Fragment key={stage.name}>
            <Box flexDirection="column" marginRight={1}>
              <Text color={statusColor(stage.status)}>
                {statusIcon(stage.status)} {stage.name}
                {stage.status === 'active' && stage.progress !== undefined
                  ? ` ${stage.progress}%`
                  : ''}
              </Text>
              <Text dimColor>{stage.agent}</Text>
            </Box>
            {i < stages.length - 1 && (
              <Box marginRight={1}>
                <Text dimColor>━━</Text>
              </Box>
            )}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}
