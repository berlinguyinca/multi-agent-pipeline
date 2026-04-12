import React from 'react';
import { Box, Text } from 'ink';
import PipelineBar from '../components/PipelineBar.js';
import StreamOutput from '../components/StreamOutput.js';

interface StageInfo {
  name: string;
  status: 'waiting' | 'active' | 'complete' | 'failed';
  agent: string;
  progress?: number;
}

interface PipelineScreenProps {
  stages: StageInfo[];
  iteration: number;
  output: string;
  streaming: boolean;
  stageName: string;
  agentName: string;
}

export default function PipelineScreen({
  stages,
  iteration,
  output,
  streaming,
  stageName,
  agentName,
}: PipelineScreenProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <PipelineBar stages={stages} iteration={iteration} />
      <Box flexDirection="column">
        <Text bold>
          {stageName} — {agentName}
        </Text>
        <StreamOutput content={output} streaming={streaming} maxHeight={20} />
      </Box>
    </Box>
  );
}
