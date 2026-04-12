import React from 'react';
import { Box } from 'ink';
import PipelineBar from '../components/PipelineBar.js';
import TestProgress from '../components/TestProgress.js';
import StreamOutput from '../components/StreamOutput.js';

interface StageInfo {
  name: string;
  status: 'waiting' | 'active' | 'complete' | 'failed';
  agent: string;
  progress?: number;
}

interface TestItem {
  name: string;
  status: 'pending' | 'writing' | 'passing' | 'failing';
}

interface ExecuteScreenProps {
  stages: StageInfo[];
  iteration: number;
  output: string;
  streaming: boolean;
  tests: TestItem[];
}

export default function ExecuteScreen({
  stages,
  iteration,
  output,
  streaming,
  tests,
}: ExecuteScreenProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <PipelineBar stages={stages} iteration={iteration} />
      <TestProgress tests={tests} />
      <StreamOutput content={output} streaming={streaming} maxHeight={15} />
    </Box>
  );
}
