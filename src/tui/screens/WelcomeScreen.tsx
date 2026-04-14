import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';
import Logo from '../components/Logo.js';
import AgentPicker from '../components/AgentPicker.js';
import type { DetectionResult } from '../../types/adapter.js';
import type { AgentAssignment, StageName } from '../../types/config.js';

interface WelcomeScreenProps {
  onStart: (prompt: string, githubIssueUrl?: string) => void;
  onResume: () => void;
  detection: DetectionResult;
  agents: Record<StageName, AgentAssignment>;
  onAssign: (stage: string, agent: string) => void;
  initialGithubIssueUrl?: string;
  githubIssueError?: string;
}

export default function WelcomeScreen({
  onStart,
  onResume,
  detection,
  agents,
  onAssign,
  initialGithubIssueUrl = '',
  githubIssueError,
}: WelcomeScreenProps) {
  const [prompt, setPrompt] = useState('');
  const [githubIssueUrl, setGithubIssueUrl] = useState(initialGithubIssueUrl);
  const availableAgents: string[] = [];
  if (detection.claude.installed) availableAgents.push('claude');
  if (detection.codex.installed) availableAgents.push('codex');
  if (detection.ollama.installed) availableAgents.push('ollama');

  const stages = [
    { name: 'spec', agent: agents.spec.adapter },
    { name: 'review', agent: agents.review.adapter },
    { name: 'qa', agent: agents.qa.adapter },
    { name: 'execute', agent: agents.execute.adapter },
    { name: 'docs', agent: agents.docs.adapter },
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
        <Text bold>GitHub issue URL (optional)</Text>
        <Box flexDirection="row">
          <Text>{chalk.cyan('issue> ')}</Text>
          <TextInput
            value={githubIssueUrl}
            onChange={setGithubIssueUrl}
            placeholder="https://github.com/owner/repo/issues/123"
          />
        </Box>
        {githubIssueError ? <Text color="red">{githubIssueError}</Text> : null}
        <Text bold>What would you like to build?</Text>
        <Box flexDirection="row">
          <Text>{chalk.cyan('> ')}</Text>
          <TextInput
            value={prompt}
            onChange={setPrompt}
            onSubmit={(submitted) => {
              const trimmed = submitted.trim();
              if (trimmed || githubIssueUrl.trim()) {
                onStart(trimmed, githubIssueUrl.trim() || undefined);
                setPrompt('');
              }
            }}
            placeholder="Describe the feature or project..."
          />
        </Box>
      </Box>
    </Box>
  );
}
