import React, { useState } from 'react';
import { Box, Text } from 'ink';

interface AgentPickerProps {
  stages: Array<{ name: string; agent: string }>;
  availableAgents: string[];
  onAssign: (stageName: string, agent: string) => void;
  focusedStage: number;
}

export default function AgentPicker({
  stages,
  availableAgents,
  onAssign,
  focusedStage,
}: AgentPickerProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={14}>
          <Text bold>STAGE</Text>
        </Box>
        <Box width={20}>
          <Text bold>AGENT</Text>
        </Box>
      </Box>
      {stages.map((stage, i) => (
        <Box key={stage.name}>
          <Box width={14}>
            <Text color={i === focusedStage ? 'cyan' : undefined}>
              {i === focusedStage ? '>' : ' '} {stage.name}
            </Text>
          </Box>
          <Box width={20}>
            <Text>{stage.agent}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
