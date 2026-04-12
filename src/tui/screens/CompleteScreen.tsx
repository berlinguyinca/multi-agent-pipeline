import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

interface CompleteScreenProps {
  iterations: number;
  testsTotal: number;
  testsPassing: number;
  filesCreated: string[];
  duration: number;
  outputDir: string;
  onNewPipeline: () => void;
}

export default function CompleteScreen({
  iterations,
  testsTotal,
  testsPassing,
  filesCreated,
  duration,
  outputDir,
  onNewPipeline,
}: CompleteScreenProps) {
  const durationSecs = (duration / 1000).toFixed(1);

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="green" padding={1}>
        <Text>{chalk.green.bold('Pipeline Complete!')}</Text>
        <Text> </Text>
        <Text>
          {chalk.dim('Iterations:')} {iterations}
        </Text>
        <Text>
          {chalk.dim('Tests:')} {chalk.green(`${testsPassing}/${testsTotal} passing`)}
        </Text>
        <Text>
          {chalk.dim('Duration:')} {durationSecs}s
        </Text>
        <Text>
          {chalk.dim('Output:')} {outputDir}
        </Text>
        {filesCreated.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text>{chalk.dim('Files created:')}</Text>
            {filesCreated.map((f) => (
              <Text key={f}>{chalk.dim('  •')} {f}</Text>
            ))}
          </Box>
        )}
      </Box>
      <Box>
        <Text dimColor>Press [Enter] or run again to start a new pipeline</Text>
      </Box>
    </Box>
  );
}
