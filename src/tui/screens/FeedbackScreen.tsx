import React, { useState } from 'react';
import { Box, Text } from 'ink';
import PipelineBar from '../components/PipelineBar.js';
import RefinementScore from '../components/RefinementScore.js';
import SpecViewer from '../components/SpecViewer.js';
import SpecDiff from '../components/SpecDiff.js';
import ChatInput from '../components/ChatInput.js';
import KeyboardHelp from '../components/KeyboardHelp.js';
import { useKeyboard } from '../hooks/useKeyboard.js';

interface StageInfo {
  name: string;
  status: 'waiting' | 'active' | 'complete' | 'failed';
  agent: string;
  progress?: number;
}

interface ScoreEntry {
  iteration: number;
  score: number;
}

interface FeedbackScreenProps {
  stages: StageInfo[];
  iteration: number;
  scores: ScoreEntry[];
  specContent: string;
  previousSpecContent?: string;
  onApprove: () => void;
  onFeedback: (text: string) => void;
}

export default function FeedbackScreen({
  stages,
  iteration,
  scores,
  specContent,
  previousSpecContent,
  onApprove,
  onFeedback,
}: FeedbackScreenProps) {
  const [showDiff, setShowDiff] = useState(false);
  const hasDiff = previousSpecContent !== undefined && previousSpecContent !== '';

  useKeyboard([
    { key: 'e', ctrl: true, handler: onApprove },
    {
      key: '\t',
      handler: () => {
        if (hasDiff) {
          setShowDiff((prev) => !prev);
        }
      },
    },
  ]);

  return (
    <Box flexDirection="column" gap={1}>
      <PipelineBar stages={stages} iteration={iteration} />
      <RefinementScore scores={scores} />
      {hasDiff && showDiff ? (
        <SpecDiff oldContent={previousSpecContent} newContent={specContent} />
      ) : (
        <SpecViewer content={specContent} maxHeight={15} />
      )}
      {hasDiff && (
        <Box>
          <Text dimColor>
            Press [Tab] to toggle {showDiff ? 'spec view' : 'diff view'}
          </Text>
        </Box>
      )}
      <ChatInput
        onSubmit={onFeedback}
        placeholder="Provide feedback to refine the spec..."
        prefix="> "
      />
      <KeyboardHelp
        shortcuts={[
          { key: 'Enter', label: 'Refine' },
          { key: 'Ctrl+E', label: 'Approve' },
        ]}
      />
    </Box>
  );
}
