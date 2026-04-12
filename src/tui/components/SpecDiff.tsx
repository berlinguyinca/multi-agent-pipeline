import { Box, Text } from 'ink';
import { diffLines } from 'diff';
import chalk from 'chalk';

interface Props {
  oldContent: string;
  newContent: string;
}

export default function SpecDiff({ oldContent, newContent }: Props) {
  const changes = diffLines(oldContent, newContent);

  return (
    <Box flexDirection="column">
      {changes.map((change, i) => {
        const lines = change.value.split('\n').filter((l, idx, arr) => {
          // Remove trailing empty line from split
          return !(idx === arr.length - 1 && l === '');
        });

        if (change.added) {
          return lines.map((line, j) => (
            <Text key={`${i}-${j}`}>{chalk.green(`+ ${line}`)}</Text>
          ));
        }

        if (change.removed) {
          return lines.map((line, j) => (
            <Text key={`${i}-${j}`}>{chalk.red(`- ${line}`)}</Text>
          ));
        }

        return lines.map((line, j) => (
          <Text key={`${i}-${j}`}>{chalk.dim(`  ${line}`)}</Text>
        ));
      })}
    </Box>
  );
}
