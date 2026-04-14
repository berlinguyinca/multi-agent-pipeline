import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import type { DocumentationResult, QaAssessment } from '../../types/spec.js';
import type { GitHubReportResult } from '../../types/github.js';

interface CompleteScreenProps {
  iterations: number;
  testsTotal: number;
  testsPassing: number;
  filesCreated: string[];
  duration: number;
  outputDir: string;
  qaAssessments?: QaAssessment[];
  documentationResult?: DocumentationResult;
  githubReport?: GitHubReportResult;
  onNewPipeline: () => void;
}

export default function CompleteScreen({
  iterations,
  testsTotal,
  testsPassing,
  filesCreated,
  duration,
  outputDir,
  qaAssessments = [],
  documentationResult,
  githubReport,
  onNewPipeline,
}: CompleteScreenProps) {
  const durationSecs = (duration / 1000).toFixed(1);
  const finalCodeQa = [...qaAssessments].reverse().find((qa) => qa.target === 'code');

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
        {finalCodeQa && (
          <Text>
            {chalk.dim('QA:')} {finalCodeQa.passed ? chalk.green('passed') : chalk.red('failed')}
            {finalCodeQa.summary ? ` — ${finalCodeQa.summary}` : ''}
          </Text>
        )}
        {githubReport && (
          <Text>
            {chalk.dim('GitHub:')}{' '}
            {githubReport.posted
              ? chalk.green(`posted${githubReport.commentUrl ? ` (${githubReport.commentUrl})` : ''}`)
              : chalk.red(`not posted: ${githubReport.error ?? 'unknown error'}`)}
          </Text>
        )}
        {documentationResult && (
          <Box flexDirection="column" marginTop={1}>
            <Text>{chalk.dim('Documentation updated:')}</Text>
            {documentationResult.filesUpdated.length > 0 ? (
              documentationResult.filesUpdated.map((f) => (
                <Text key={f}>{chalk.dim('  •')} {f}</Text>
              ))
            ) : (
              <Text>{chalk.dim('  •')} No Markdown files changed</Text>
            )}
          </Box>
        )}
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
