import React from 'react';
import { Box, Text } from 'ink';
import Logo from '../components/Logo.js';
import AgentPicker from '../components/AgentPicker.js';
import ChatInput from '../components/ChatInput.js';
import type { DetectionResult } from '../../types/adapter.js';
import type { AgentAssignment, StageName } from '../../types/config.js';

interface WelcomeScreenProps {
  onStart: (prompt: string) => void;
  onResume: () => void;
  detection: DetectionResult;
  agents: Record<StageName, AgentAssignment>;
  onAssign: (stage: string, agent: string) => void;
}

export default function WelcomeScreen({
  onStart,
  onResume,
  detection,
  agents,
  onAssign,
}: WelcomeScreenProps) {
  const availableAgents: string[] = [];
  if (detection.claude.installed) availableAgents.push('claude');
  if (detection.codex.installed) availableAgents.push('codex');
  if (detection.ollama.installed) availableAgents.push('ollama');

  const stages = [
    { name: 'spec', agent: agents.spec.adapter },
    { name: 'review', agent: agents.review.adapter },
    { name: 'execute', agent: agents.execute.adapter },
  ];

  return (
    <Box flexDirection="column" gap={1}>
      <Logo />
      <Box flexDirection="column" gap={1}>
        <Text bold>Agent Assignment</Text>
        <AgentPicker
          stages={stages}
          availableAgents={availableAgents}
          onAssign={onAssign}
          focusedStage={0}
        />
      </Box>
      <Box flexDirection="column" gap={1}>
        <Text bold>What would you like to build?</Text>
        <ChatInput
          onSubmit={onStart}
          placeholder="Describe the feature or project..."
          prefix="> "
        />
      </Box>
    </Box>
  );
}
