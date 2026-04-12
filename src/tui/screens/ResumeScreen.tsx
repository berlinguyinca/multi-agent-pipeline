import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

interface SavedPipeline {
  id: string;
  name: string;
  stage: string;
  iteration: number;
  agents: string;
  timestamp: string;
}

interface ResumeScreenProps {
  pipelines: SavedPipeline[];
  onResume: (id: string) => void;
  onBack: () => void;
}

export default function ResumeScreen({
  pipelines,
  onResume,
  onBack,
}: ResumeScreenProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Resume Pipeline</Text>
      {pipelines.length === 0 ? (
        <Box>
          <Text dimColor>No saved pipelines found.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" gap={0}>
          {pipelines.map((pipeline, i) => (
            <Box key={pipeline.id} flexDirection="row" gap={2}>
              <Text>{chalk.dim(`${i + 1}.`)}</Text>
              <Box flexDirection="column">
                <Text bold>{pipeline.name}</Text>
                <Text dimColor>
                  Stage: {pipeline.stage} | Iteration: {pipeline.iteration} | Agents: {pipeline.agents}
                </Text>
                <Text dimColor>{pipeline.timestamp}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}
      <Box flexDirection="row" gap={2}>
        <Text dimColor>Select a pipeline to resume or press [Esc] to go back</Text>
      </Box>
    </Box>
  );
}
